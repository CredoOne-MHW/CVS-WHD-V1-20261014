/**
 * Chat inside a company — threads, messages, groups — and the notices an administrator shows in the apps.
 *
 * Two rules run through all of it:
 *   • a member is known to other members by name and role only — no phone number, no e-mail address ever
 *     leaves this file;
 *   • a message is stored first and pushed second, so a message is never lost because the real-time
 *     service or a phone was unreachable.
 */
import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { ChatThread, ChatMessage, Announcement, User, Role } from "../../models";
import { can, tenant } from "../../middleware/auth";
import { h, parse, notFound, badRequest, forbidden, paging, HttpError } from "../../lib/http";
import { rateLimit } from "../../lib/cache";
import { publish, authorize, clientConfig, realtimeOn } from "../../lib/realtime";
import { pushToUsers, registerDevice, forgetDevice } from "../../lib/push";
import multer from "multer";
import { LIMITS, threadChannel, userChannel, companyChannel, EVENTS, publicMember, NOTICE_TONES, fileAccepted, FILE_TYPES, isImage } from "../../../shared/chat";
import { putAt, signedUrl } from "../../lib/s3";
import { s3Area } from "../../../shared/platform";
import { Company } from "../../models";

const r = Router();
const oid = (v: any) => new mongoose.Types.ObjectId(String(v));
const me = (req: any) => ({ id: String(req.auth.userId), name: req.auth.name as string, companyId: req.auth.companyId });

/** Everyone in the company who may be messaged — names and roles only. */
/**
 * Who somebody may find and talk to, inside their own company.
 *
 * The company always comes from the signed-in session, never from the request, so one workspace's people
 * can never appear in another's — that has been true since this was written and nothing here changes it.
 *
 * `forCustomer` is the new part. A customer signs in to talk to the business, so they see the people who
 * work there and nobody else: other customers are left out entirely, and one customer therefore never
 * learns that another exists. Staff are unaffected and still see everyone, customers included, because
 * they are the ones who have to answer them.
 */
async function directory(companyId: any, forCustomer = false) {
  const find: any = { companyId, scope: "company" };
  // a staff row is anything not explicitly marked a customer, so users created before v1.9.0 count as staff
  if (forCustomer) find.kind = { $ne: "customer" };
  const [users, roles] = await Promise.all([
    User.find(find).select("name roleId isOwner active kind").sort({ name: 1 }).limit(2000).lean<any[]>(),
    Role.find({ companyId }).select("name").lean<any[]>().catch(() => []),
  ]);
  const roleName = new Map(roles.map((x: any) => [String(x._id), x.name]));
  return users.map((u) => publicMember(u, roleName.get(String(u.roleId))));
}

/** True when this person may not be shown to, or reached by, the person asking. */
const hiddenFromCustomer = (viewer: any, target: any) => viewer?.kind === "customer" && target?.kind === "customer";

/** The thread, if this person is in it. */
async function myThread(req: any, threadId: string) {
  const t = await ChatThread.findOne({ _id: threadId, ...tenant(req) }).lean<any>();
  if (!t) throw notFound("Conversation not found");
  if (!(t.memberIds || []).some((x: any) => String(x) === me(req).id)) throw forbidden("You are not in this conversation");
  return t;
}

/* ───────────────────────── Who you can talk to ───────────────────────── */

r.get("/chat/people", can("chats", "read"), h(async (req, res) => {
  const list = await directory(req.auth!.companyId, req.auth!.kind === "customer");
  res.json({ people: list.filter((p) => p.userId !== me(req).id), me: list.find((p) => p.userId === me(req).id) || null, realtime: clientConfig() });
}));

/* ───────────────────────── Threads ───────────────────────── */

/** My conversations, newest first, with what is unread in each. */
r.get("/chat/threads", can("chats", "read"), h(async (req, res) => {
  const { id, companyId } = me(req);
  const threads = await ChatThread.find({ companyId, memberIds: oid(id), archivedAt: null }).sort({ "lastMessage.at": -1, updatedAt: -1 }).limit(200).lean<any[]>();
  const unread = await ChatMessage.aggregate([
    { $match: { companyId: oid(companyId), threadId: { $in: threads.map((t) => t._id) }, readBy: { $ne: oid(id) }, byId: { $ne: oid(id) }, deletedAt: null } },
    { $group: { _id: "$threadId", n: { $sum: 1 } } },
  ]).catch(() => [] as any[]);
  const byThread = new Map(unread.map((x: any) => [String(x._id), x.n]));
  res.json({
    threads: threads.map((t) => ({ ...t, unread: byThread.get(String(t._id)) || 0, members: (t.members || []).map((m: any) => ({ userId: String(m.userId), name: m.name, role: m.role, isAdmin: m.isAdmin })) })),
    realtime: clientConfig(),
    channels: { user: userChannel(String(companyId), id), company: companyChannel(String(companyId)) },
  });
}));

/** Open (or start) a one-to-one conversation. The pair key makes a second one impossible. */
r.post("/chat/direct", can("chats", "create"), h(async (req, res) => {
  const b = parse(z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/) }), req.body);
  const { id, companyId } = me(req);
  if (b.userId === id) throw badRequest("You cannot message yourself");
  const other = await User.findOne({ _id: b.userId, companyId, scope: "company", active: true }).select("name roleId isOwner kind").lean<any>();
  if (!other) throw notFound("That person is not in this company");
  /**
   * Filtering the search alone would be theatre: the id is in the request, so anything that only hid
   * names could be walked straight past by sending one. The refusal belongs here, where the thread is
   * actually made.
   */
  if (hiddenFromCustomer(req.auth, other)) throw notFound("That person is not in this company");
  const pairKey = [id, b.userId].sort().join(":");
  const existing = await ChatThread.findOne({ companyId, pairKey }).lean<any>();
  if (existing) return res.json(existing);

  const mine = await User.findById(id).select("name roleId isOwner").lean<any>();
  const thread = await ChatThread.create({
    companyId,
    kind: "direct",
    pairKey,
    members: [mine, other].map((u: any) => ({ userId: u._id, name: u.name, isAdmin: !!u.isOwner, joinedAt: new Date() })),
    memberIds: [oid(id), oid(b.userId)],
    createdBy: req.auth!.email,
  });
  const payload = { ...thread.toObject(), unread: 0 };
  await publish([userChannel(String(companyId), id), userChannel(String(companyId), b.userId)], EVENTS.threadNew, payload);
  res.status(201).json(payload);
}));

/* ───────────────────────── Groups ───────────────────────── */

const groupBody = z.object({
  name: z.string().trim().min(2).max(LIMITS.groupName),
  about: z.string().max(300).optional(),
  memberIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(LIMITS.groupMembers).default([]),
});

/** Only someone with Groups › create may make one — the company's own administrator, normally. */
r.post("/chat/groups", can("chats:groups", "create"), h(async (req, res) => {
  const b = parse(groupBody, req.body);
  const { id, companyId } = me(req);
  const ids = Array.from(new Set([...(b.memberIds || []), id]));
  const users = await User.find({ _id: { $in: ids }, companyId, scope: "company", active: true }).select("name roleId isOwner kind").lean<any[]>();
  if (users.length < 1) throw badRequest("Add at least one member");
  // a customer cannot put another customer in a group either, for the same reason as above
  if (req.auth!.kind === "customer" && users.some((u: any) => String(u._id) !== id && u.kind === "customer"))
    throw badRequest("You can only add people who work at the company");
  const thread = await ChatThread.create({
    companyId,
    kind: "group",
    name: b.name,
    about: b.about,
    members: users.map((u: any) => ({ userId: u._id, name: u.name, isAdmin: String(u._id) === id || !!u.isOwner, joinedAt: new Date() })),
    memberIds: users.map((u: any) => u._id),
    createdBy: req.auth!.email,
    lastMessage: { text: `${me(req).name} created “${b.name}”`, by: "system", at: new Date(), kind: "system" },
  });
  await ChatMessage.create({ companyId, threadId: thread._id, kind: "system", text: `${me(req).name} created the group`, byId: oid(id), byName: me(req).name, readBy: [oid(id)] });
  // everyone in the group learns about it at once, and on their phone
  await publish(users.map((u: any) => userChannel(String(companyId), String(u._id))), EVENTS.threadNew, thread.toObject());
  await pushToUsers(companyId, users.map((u: any) => u._id).filter((x: any) => String(x) !== id), { title: b.name, body: `${me(req).name} added you to a group`, data: { threadId: String(thread._id) } });
  res.locals.action = "Create group";
  res.locals.item = b.name;
  res.status(201).json(thread.toObject());
}));

r.put("/chat/groups/:id", can("chats:groups", "update"), h(async (req, res) => {
  const b = parse(groupBody.partial(), req.body);
  const t = await myThread(req, req.params.id);
  if (t.kind !== "group") throw badRequest("Only a group can be changed");
  const { companyId } = me(req);
  const set: any = {};
  if (b.name) set.name = b.name;
  if (b.about !== undefined) set.about = b.about;
  if (b.memberIds) {
    const users = await User.find({ _id: { $in: b.memberIds }, companyId, scope: "company", active: true }).select("name isOwner kind").lean<any[]>();
    // the third way into a member list, and it needs the same refusal as the other two
    if (req.auth!.kind === "customer" && users.some((u: any) => String(u._id) !== me(req).id && u.kind === "customer"))
      throw badRequest("You can only add people who work at the company");
    set.members = users.map((u: any) => ({ userId: u._id, name: u.name, isAdmin: !!u.isOwner, joinedAt: new Date() }));
    set.memberIds = users.map((u: any) => u._id);
  }
  const next = await ChatThread.findByIdAndUpdate(t._id, { $set: set }, { new: true }).lean<any>();
  await publish((next.memberIds || []).map((u: any) => userChannel(String(companyId), String(u))), EVENTS.threadUpdated, next);
  res.locals.action = "Update group";
  res.locals.item = next.name;
  res.json(next);
}));

r.post("/chat/groups/:id/leave", can("chats", "update"), h(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (t.kind !== "group") throw badRequest("Only a group can be left");
  const { id, companyId, name } = me(req);
  await ChatThread.updateOne({ _id: t._id }, { $pull: { memberIds: oid(id), members: { userId: oid(id) } } });
  await ChatMessage.create({ companyId, threadId: t._id, kind: "system", text: `${name} left the group`, byId: oid(id), byName: name });
  await publish(threadChannel(String(companyId), String(t._id)), EVENTS.threadUpdated, { threadId: String(t._id) });
  res.json({ ok: true });
}));

/* ───────────────────────── Messages ───────────────────────── */

r.get("/chat/threads/:id/messages", can("chats", "read"), h(async (req, res) => {
  const t = await myThread(req, req.params.id);
  const { id, companyId } = me(req);
  const limit = Math.min(LIMITS.page, Math.max(10, Number(req.query.limit) || LIMITS.page));
  const find: any = { companyId, threadId: t._id, deletedAt: null };
  if (req.query.before) find.createdAt = { $lt: new Date(String(req.query.before)) };
  if (req.query.after) find.createdAt = { $gt: new Date(String(req.query.after)) };
  const rows = await ChatMessage.find(find).sort({ createdAt: req.query.after ? 1 : -1 }).limit(limit).lean<any[]>();
  const messages = (req.query.after ? rows : rows.reverse()).map((m) => ({ ...m, mine: String(m.byId) === id, readBy: undefined, reads: (m.readBy || []).length }));
  res.json({ thread: { ...t, members: (t.members || []).map((m: any) => ({ userId: String(m.userId), name: m.name, isAdmin: m.isAdmin })) }, messages });
}));

r.post("/chat/threads/:id/messages", can("chats", "create"), h(async (req, res) => {
  const b = parse(z.object({ text: z.string().trim().min(1).max(LIMITS.message) }), req.body);
  const t = await myThread(req, req.params.id);
  const { id, companyId, name } = me(req);
  if (!(await rateLimit(`chat:${id}`, 60, 60))) throw new HttpError(429, "Slow down a moment");

  const msg = await ChatMessage.create({ companyId, threadId: t._id, kind: "text", text: b.text, byId: oid(id), byName: name, readBy: [oid(id)] });
  const last = { text: b.text.slice(0, 140), by: name, byId: oid(id), at: msg.createdAt, kind: "text" };
  await ChatThread.updateOne({ _id: t._id }, { $set: { lastMessage: last } });

  const out = { ...msg.toObject(), mine: false, readBy: undefined, reads: 1, threadId: String(t._id) };
  const others = (t.memberIds || []).filter((x: any) => String(x) !== id);
  await publish(threadChannel(String(companyId), String(t._id)), EVENTS.message, out);
  // the thread list of everyone else updates even when they do not have the conversation open
  await publish(others.map((u: any) => userChannel(String(companyId), String(u))), EVENTS.threadUpdated, { threadId: String(t._id), lastMessage: last });
  await pushToUsers(companyId, others, {
    title: t.kind === "group" ? t.name || "Group" : name,
    body: t.kind === "group" ? `${name}: ${b.text.slice(0, 120)}` : b.text.slice(0, 140),
    data: { threadId: String(t._id), kind: "chat" },
  });
  res.status(201).json({ ...out, mine: true });
}));

const attach = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.fileMb * 1024 * 1024 } });

/**
 * Sends a file into a conversation.
 *
 * The bytes go to the company's own S3 folder, never into the database, and the message carries only a key.
 * Nothing is served directly from that bucket: a reader asks for a link that expires, which is checked
 * against their membership of the thread at the moment they ask.
 */
r.post("/chat/threads/:id/files", can("chats", "create"), attach.single("file"), h(async (req, res) => {
  const t = await myThread(req, req.params.id);
  const { id, companyId, name } = me(req);
  const f = (req as any).file;
  if (!f) throw badRequest("No file was sent");
  if (!fileAccepted(f.mimetype)) throw badRequest(`${f.originalname} is a kind of file this does not take. Images, PDF, Word, Excel, CSV and text are fine.`);
  if (!(await rateLimit(`chatfile:${id}`, 20, 60))) throw new HttpError(429, "Slow down a moment");

  const company = await Company.findById(companyId).select("code s3Enabled").lean<any>();
  if (!company?.s3Enabled) throw badRequest("File storage is switched off for this company, so attachments cannot be kept.");

  const ext = FILE_TYPES[f.mimetype.toLowerCase()] || "bin";
  const key = `${s3Area(company.code, "chat", String(t._id))}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  await putAt(key, f.buffer, f.mimetype);

  const caption = String(req.body?.text || "").trim().slice(0, LIMITS.message);
  const msg = await ChatMessage.create({
    companyId,
    threadId: t._id,
    kind: "file",
    text: caption || f.originalname,
    file: { key, name: f.originalname, size: f.size, mime: f.mimetype },
    byId: oid(id),
    byName: name,
    readBy: [oid(id)],
  });

  const last = { text: `${isImage(f.mimetype) ? "Photo" : "File"}: ${caption || f.originalname}`.slice(0, 140), by: name, byId: oid(id), at: msg.createdAt, kind: "file" };
  await ChatThread.updateOne({ _id: t._id }, { $set: { lastMessage: last } });

  const out = { ...msg.toObject(), mine: false, readBy: undefined, reads: 1, threadId: String(t._id) };
  const others = (t.memberIds || []).filter((x: any) => String(x) !== id);
  await publish(threadChannel(String(companyId), String(t._id)), EVENTS.message, out);
  await publish(others.map((u: any) => userChannel(String(companyId), String(u))), EVENTS.threadUpdated, { threadId: String(t._id), lastMessage: last });
  await pushToUsers(companyId, others, {
    title: t.kind === "group" ? t.name || "Group" : name,
    body: last.text,
    data: { threadId: String(t._id), kind: "chat" },
  });
  res.status(201).json({ ...out, mine: true });
}));

/**
 * A link to one attachment, good for a few minutes.
 *
 * Membership is checked here rather than at upload time, because who is in a group changes: somebody removed
 * from a thread stops being able to open its files from that moment, without anything having to be moved.
 */
r.get("/chat/files/:messageId", can("chats", "read"), h(async (req, res) => {
  const msg = await ChatMessage.findOne({ _id: req.params.messageId, ...tenant(req) }).lean<any>();
  if (!msg?.file?.key) throw notFound("That attachment is not here");
  await myThread(req, String(msg.threadId)); // throws unless this person is in the conversation
  // ?download=1 asks for a link that saves the file under its own name rather than opening it in a tab
  const save = req.query.download === "1" || req.query.download === "true";
  res.locals.action = save ? "Download chat attachment" : "Open chat attachment";
  res.locals.item = msg.file.name;
  res.json({ url: await signedUrl(msg.file.key, 300, save ? msg.file.name : undefined), name: msg.file.name, mime: msg.file.mime });
}));

/** Marks everything up to now as read, and tells the others. */
r.post("/chat/threads/:id/read", can("chats", "read"), h(async (req, res) => {
  const t = await myThread(req, req.params.id);
  const { id, companyId } = me(req);
  const r2 = await ChatMessage.updateMany({ companyId, threadId: t._id, readBy: { $ne: oid(id) } }, { $addToSet: { readBy: oid(id) } });
  if (r2.modifiedCount) await publish(threadChannel(String(companyId), String(t._id)), EVENTS.messageRead, { threadId: String(t._id), userId: id, at: new Date() });
  res.json({ read: r2.modifiedCount || 0 });
}));

/** Someone is typing — never stored, and ignored when there is no real-time service. */
r.post("/chat/threads/:id/typing", can("chats", "create"), h(async (req, res) => {
  if (!realtimeOn()) return res.json({ ok: true });
  const t = await myThread(req, req.params.id);
  const { id, companyId, name } = me(req);
  await publish(threadChannel(String(companyId), String(t._id)), EVENTS.typing, { userId: id, name });
  res.json({ ok: true });
}));

/* ───────────────────────── Notices ───────────────────────── */

/** What the apps show scrolling across the top. Everyone may read; only an administrator may write. */
r.get("/chat/notices", can("chats", "read"), h(async (req, res) => {
  const now = new Date();
  const items = await Announcement.find({ ...tenant(req), active: true, $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }] })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean<any[]>();
  res.json({ items });
}));

r.get("/chat/notices/all", can("chats:notices", "read"), h(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const [items, total] = await Promise.all([
    Announcement.find(tenant(req)).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<any[]>(),
    Announcement.countDocuments(tenant(req)),
  ]);
  res.json({ items, total, page, limit });
}));

r.post("/chat/notices", can("chats:notices", "create"), h(async (req, res) => {
  const b = parse(
    z.object({
      text: z.string().trim().min(2).max(LIMITS.noticeLength),
      tone: z.enum(NOTICE_TONES).default("info"),
      push: z.boolean().default(false),
      endsAt: z.string().optional(),
    }),
    req.body
  );
  const { companyId } = me(req);
  const notice = await Announcement.create({ ...tenant(req), text: b.text, tone: b.tone, push: b.push, endsAt: b.endsAt ? new Date(b.endsAt) : undefined, createdBy: req.auth!.email, active: true });
  await publish(companyChannel(String(companyId)), EVENTS.notice, notice.toObject());
  if (b.push) {
    const users = await User.find({ companyId, scope: "company", active: true }).select("_id").lean<any[]>();
    await pushToUsers(companyId, users.map((u) => u._id), { title: "Notice", body: b.text.slice(0, 200), data: { kind: "notice" } });
  }
  res.locals.action = "Post notice";
  res.locals.item = b.text.slice(0, 60);
  res.status(201).json(notice.toObject());
}));

r.post("/chat/notices/:id/stop", can("chats:notices", "update"), h(async (req, res) => {
  const n = await Announcement.findOneAndUpdate({ _id: req.params.id, ...tenant(req) }, { $set: { active: false } }, { new: true }).lean<any>();
  if (!n) throw notFound();
  await publish(companyChannel(String(me(req).companyId)), EVENTS.notice, { stopped: String(n._id) });
  res.locals.action = "Stop notice";
  res.json(n);
}));

/* ───────────────────────── Devices and real-time ───────────────────────── */

/**
 * Registering this phone for notifications.
 *
 * Deliberately needs no permission beyond being signed in. It used to require Chats read, which meant
 * anybody without that module — every customer, and any staff role that does not include chat — could not
 * register at all, and so received no notification of anything, ever. What may be *sent* to somebody is
 * decided when each notification goes out; this only records that a phone belongs to them.
 */
r.post("/chat/devices", h(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10).max(200), platform: z.string().max(10).default("android"), appVersion: z.string().max(20).optional() }), req.body);
  await registerDevice(req.auth!.companyId!, req.auth!.userId, b.token, b.platform || "android", b.appVersion).catch((e: any) => {
    throw badRequest(e.message);
  });
  res.status(201).json({ ok: true });
}));

r.delete("/chat/devices", h(async (req, res) => {
  await forgetDevice(String(req.query.token || ""));
  res.json({ ok: true });
}));

/**
 * Signs a private channel for this user — and only the channels that belong to them: their own, their
 * company's, and threads they are a member of.
 */
r.post("/chat/realtime/auth", can("chats", "read"), h(async (req, res) => {
  const b = parse(z.object({ socket_id: z.string().max(80), channel_name: z.string().max(160) }), req.body);
  const { id, companyId } = me(req);
  const ch = b.channel_name;
  let allowed = ch === userChannel(String(companyId), id) || ch === companyChannel(String(companyId));
  const m = /^private-co-[a-f0-9]{24}-thread-([a-f0-9]{24})$/.exec(ch);
  if (!allowed && m) {
    if (!ch.startsWith(`private-co-${companyId}-`)) throw forbidden("Not your company");
    allowed = !!(await ChatThread.exists({ _id: m[1], companyId, memberIds: oid(id) }));
  }
  if (!allowed) throw forbidden("You may not listen on that channel");
  res.json(await authorize(ch, b.socket_id, id));
}));

export default r;

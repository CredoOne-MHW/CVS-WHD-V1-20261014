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
import { ChatThread, ChatMessage, Announcement, User, Role } from "../../models";
import { can, tenant } from "../../middleware/auth";
import { h, parse, notFound, badRequest, forbidden, paging, HttpError } from "../../lib/http";
import { rateLimit } from "../../lib/cache";
import { publish, authorize, clientConfig, realtimeOn } from "../../lib/realtime";
import { pushToUsers, registerDevice, forgetDevice } from "../../lib/push";
import { LIMITS, threadChannel, userChannel, companyChannel, EVENTS, publicMember, NOTICE_TONES } from "../../../shared/chat";

const r = Router();
const oid = (v: any) => new mongoose.Types.ObjectId(String(v));
const me = (req: any) => ({ id: String(req.auth.userId), name: req.auth.name as string, companyId: req.auth.companyId });

/** Everyone in the company who may be messaged — names and roles only. */
async function directory(companyId: any) {
  const [users, roles] = await Promise.all([
    User.find({ companyId, scope: "company" }).select("name roleId isOwner active").sort({ name: 1 }).limit(2000).lean<any[]>(),
    Role.find({ companyId }).select("name").lean<any[]>().catch(() => []),
  ]);
  const roleName = new Map(roles.map((x: any) => [String(x._id), x.name]));
  return users.map((u) => publicMember(u, roleName.get(String(u.roleId))));
}

/** The thread, if this person is in it. */
async function myThread(req: any, threadId: string) {
  const t = await ChatThread.findOne({ _id: threadId, ...tenant(req) }).lean<any>();
  if (!t) throw notFound("Conversation not found");
  if (!(t.memberIds || []).some((x: any) => String(x) === me(req).id)) throw forbidden("You are not in this conversation");
  return t;
}

/* ───────────────────────── Who you can talk to ───────────────────────── */

r.get("/chat/people", can("chats", "read"), h(async (req, res) => {
  const list = await directory(req.auth!.companyId);
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
  const other = await User.findOne({ _id: b.userId, companyId, scope: "company", active: true }).select("name roleId isOwner").lean<any>();
  if (!other) throw notFound("That person is not in this company");
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
  const users = await User.find({ _id: { $in: ids }, companyId, scope: "company", active: true }).select("name roleId isOwner").lean<any[]>();
  if (users.length < 1) throw badRequest("Add at least one member");
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
    const users = await User.find({ _id: { $in: b.memberIds }, companyId, scope: "company", active: true }).select("name isOwner").lean<any[]>();
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
  const last = { text: b.text.slice(0, 140), by: name, at: msg.createdAt, kind: "text" };
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

r.post("/chat/devices", can("chats", "read"), h(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10).max(200), platform: z.string().max(10).default("android"), appVersion: z.string().max(20).optional() }), req.body);
  await registerDevice(req.auth!.companyId!, req.auth!.userId, b.token, b.platform || "android", b.appVersion).catch((e: any) => {
    throw badRequest(e.message);
  });
  res.status(201).json({ ok: true });
}));

r.delete("/chat/devices", can("chats", "read"), h(async (req, res) => {
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

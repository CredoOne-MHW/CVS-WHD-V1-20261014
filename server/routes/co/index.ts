import { Router } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import mongoose, { Types } from "mongoose";
import * as XLSX from "xlsx";
import { Lead, Connector, IntakeEvent, Company, User, Webhook, Otp, AiAgent, AiAllocation, CompanyAgent, Role, Plan, AiProvider, AiUsage } from "../../models";
import { can, requireScope, tenant, invalidateAuth } from "../../middleware/auth";
import { h, parse, notFound, badRequest, forbidden, paging, dateRange, escapeRegex, HttpError } from "../../lib/http";
import { upsertLead, mapFields, runEvent } from "../../lib/intake";
import { dispatch, fireEvent } from "../../lib/whatsapp";
import { parseSheet, leadTemplateBuffer, extractText, KB_EXTENSIONS } from "../../lib/files";
import { putObject, deleteObject, folderFor, companyFolder, relayoutCompany } from "../../lib/s3";
import { encrypt, decrypt, randomKey, sha256, maskSecret } from "../../lib/crypto";
import { chat, walletFor } from "../../lib/ai";
import { webhookRoutes, waLogRoutes, activityRoutes, roleRoutes } from "../shared";
import { reportRoutes } from "../reports";
import { assistantChat, assistantInfo } from "../../lib/agentic";
import { rateLimit, invalidate } from "../../lib/cache";
import { publicBranding } from "../../lib/tenant";
import { LEAD_STATUSES, LOST_REASONS, LOST_STATUS, WON_STATUS, CONNECTOR_TYPES, normalizePhone } from "../../../shared/constants";

const r = Router();
r.use(requireScope("company"));
// connector edits must reach the public intake cache immediately
r.use("/integrations", (req, res, next) => {
  if (req.method !== "GET") res.on("finish", () => invalidate("conn:").catch(() => undefined));
  next();
});
// Vercel caps request bodies at ~4.5 MB; keep uploads under that.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 10 } });
const oid = (s: string) => new mongoose.Types.ObjectId(s);

/* ───────────── Dashboard ───────────── */
r.get("/dashboard", can("dashboard", "read"), h(async (req, res) => {
  const cid = oid(req.auth!.companyId!);
  const days = Math.min(365, parseInt(String(req.query.days)) || 30);
  const since = new Date(Date.now() - days * 86400_000);
  const base = { companyId: cid, deletedAt: null };
  const startToday = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30");
  const [funnel, sources, lost, trend, today, dueFollowups, total, recent] = await Promise.all([
    Lead.aggregate([{ $match: { ...base, createdAt: { $gte: since } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Lead.aggregate([
      { $match: { ...base, createdAt: { $gte: since } } },
      { $group: { _id: "$source", n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ["$status", WON_STATUS] }, 1, 0] } } } },
      { $sort: { n: -1 } },
    ]),
    Lead.aggregate([{ $match: { ...base, status: LOST_STATUS, updatedAt: { $gte: since } } }, { $group: { _id: "$lostReason", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Lead.aggregate([
      { $match: { ...base, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ["$status", WON_STATUS] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    Lead.countDocuments({ ...base, createdAt: { $gte: startToday } }),
    Lead.find({ ...base, $or: [{ status: "Follow-ups needed" }, { nextFollowUpAt: { $lte: new Date(Date.now() + 86400_000) } }], status: { $nin: [LOST_STATUS, WON_STATUS] } }).sort({ nextFollowUpAt: 1, updatedAt: 1 }).limit(8).select("name phone whatsapp status nextFollowUpAt source").lean(),
    Lead.countDocuments({ ...base, createdAt: { $gte: since } }),
    Lead.find(base).sort({ createdAt: -1 }).limit(6).select("name source status createdAt").lean(),
  ]);
  const won = funnel.find((f: any) => f._id === WON_STATUS)?.n || 0;
  const lostN = funnel.find((f: any) => f._id === LOST_STATUS)?.n || 0;
  const untouched = funnel.find((f: any) => f._id === "New")?.n || 0;
  res.json({ days, total, today, won, lost: lostN, untouched, conversion: total ? +((won / total) * 100).toFixed(1) : 0, funnel, sources, lostReasons: lost, trend, dueFollowups, recent });
}));

/* ───────────── Leads ───────────── */
const leadBody = z.object({
  name: z.string().max(150).optional().default(""),
  whatsapp: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(500).optional(),
  comments: z.string().max(5000).optional(),
  source: z.string().max(60).optional(),
  campaign: z.string().max(120).optional(),
  medium: z.string().max(60).optional(),
  referral: z.string().max(120).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  nextFollowUpAt: z.coerce.date().optional().nullable(),
  consentWhatsapp: z.boolean().optional(),
});

function leadQuery(req: any) {
  const q: any = { ...tenant(req), deletedAt: null, ...dateRange(req.query) };
  if (req.query.status) q.status = { $in: String(req.query.status).split(",") };
  if (req.query.source) q.source = { $in: String(req.query.source).split(",") };
  if (req.query.campaign) q.campaign = req.query.campaign;
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q)), $options: "i" };
    q.$or = [{ name: rx }, { phone: rx }, { whatsapp: rx }, { email: rx }, { comments: rx }, { address: rx }];
  }
  return q;
}

r.get("/leads/meta", can("leads", "read"), h(async (req, res) => {
  const sources = await Lead.distinct("source", { ...tenant(req), deletedAt: null });
  const campaigns = await Lead.distinct("campaign", { ...tenant(req), deletedAt: null });
  res.json({ statuses: LEAD_STATUSES, lostReasons: LOST_REASONS, sources, campaigns: campaigns.filter(Boolean) });
}));

r.get("/leads", can("leads", "read"), h(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const q = leadQuery(req);
  const sort: any = req.query.sort === "score" ? { score: -1 } : req.query.sort === "updated" ? { updatedAt: -1 } : { createdAt: -1 };
  const [items, total, counts] = await Promise.all([
    Lead.find(q).sort(sort).skip(skip).limit(limit).select("-attribution.raw -remarks").lean(),
    Lead.countDocuments(q),
    Lead.aggregate([{ $match: { companyId: oid(req.auth!.companyId!), deletedAt: null } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  res.json({ items, total, page, limit, counts: Object.fromEntries(counts.map((c: any) => [c._id, c.n])) });
}));

r.get("/leads/template.:fmt", can("leads", "create"), (req, res) => {
  const fmt = req.params.fmt === "csv" ? "csv" : "xlsx";
  res.setHeader("Content-Disposition", `attachment; filename="lead-import-template.${fmt}"`);
  res.setHeader("Content-Type", fmt === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(leadTemplateBuffer(fmt));
});

r.get("/leads/export.csv", can("leads", "read"), h(async (req, res) => {
  const rows = await Lead.find(leadQuery(req)).sort({ createdAt: -1 }).limit(50_000).lean();
  const data = rows.map((l: any) => ({
    Name: l.name, "WhatsApp No": l.whatsapp, "Phone No": l.phone, Email: l.email, Address: l.address, Comments: l.comments, Source: l.source, Campaign: l.campaign, Medium: l.medium, Referral: l.referral, Status: l.status, "Lost reason": l.lostReasonOther || l.lostReason, Score: l.score, "Created (IST)": new Date(l.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  }));
  res.locals.logRead = true;
  res.locals.action = "Export";
  res.setHeader("Content-Disposition", `attachment; filename="leads-${Date.now()}.csv"`);
  res.setHeader("Content-Type", "text/csv");
  res.send(XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(data)));
}));

r.get("/leads/:id", can("leads", "read"), h(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...tenant(req), deletedAt: null }).lean();
  if (!lead) throw notFound();
  res.json(lead);
}));

r.post("/leads", can("leads", "create"), h(async (req, res) => {
  const b = parse(leadBody, req.body);
  const { lead, created } = await upsertLead(req.auth!.companyId!, { ...b, source: b.source || "manual", consent: b.consentWhatsapp != null ? { whatsapp: b.consentWhatsapp, text: "Recorded by staff" } : undefined } as any, { by: req.auth!.name });
  res.locals.item = lead.name || lead.phone;
  res.status(created ? 201 : 200).json({ lead, created });
}));

/** Edit, including status change with mandatory lost reason + remark trail. */
r.put("/leads/:id", can("leads", "update"), h(async (req, res) => {
  const b = parse(leadBody.extend({ remark: z.string().max(2000).optional(), lostReason: z.enum(LOST_REASONS).optional(), lostReasonOther: z.string().max(500).optional() }), req.body);
  const lead = await Lead.findOne({ _id: req.params.id, ...tenant(req), deletedAt: null });
  if (!lead) throw notFound();
  const from = lead.status;
  if (b.status === LOST_STATUS) {
    if (!b.lostReason) throw badRequest("Select a lost reason");
    if (b.lostReason === "Other" && !b.lostReasonOther?.trim()) throw badRequest("Describe the reason");
  }
  const { remark, consentWhatsapp, ...fields } = b;
  if (fields.phone) fields.phone = normalizePhone(fields.phone);
  if (fields.whatsapp) fields.whatsapp = normalizePhone(fields.whatsapp);
  lead.set(fields);
  if (b.status && b.status !== LOST_STATUS) lead.set({ lostReason: undefined, lostReasonOther: undefined });
  if (consentWhatsapp != null) lead.consent = { ...(lead.consent || {}), whatsapp: consentWhatsapp, text: "Updated by staff", capturedAt: new Date() };
  if (remark || (b.status && b.status !== from)) {
    lead.remarks.push({ by: req.auth!.name, text: remark || (b.status === LOST_STATUS ? `Lost: ${b.lostReason === "Other" ? b.lostReasonOther : b.lostReason}` : ""), statusFrom: b.status && b.status !== from ? from : undefined, statusTo: b.status && b.status !== from ? b.status : undefined });
  }
  await lead.save();
  res.locals.item = lead.name || lead.phone;
  if (b.status && b.status !== from && lead.whatsapp) {
    const c = await Company.findById(lead.companyId).lean<any>();
    fireEvent("company", req.auth!.companyId, "lead_status_changed", { phone: lead.whatsapp, name: lead.name, company: c?.name, message: `Hi ${lead.name || ""}, your request with ${c?.name} is now: ${b.status}.`, params: { status: b.status, previous: from } }).catch(() => undefined);
  }
  res.json(lead);
}));

r.post("/leads/bulk-status", can("leads", "update"), h(async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.string()).min(1).max(500), status: z.enum(LEAD_STATUSES), lostReason: z.enum(LOST_REASONS).optional(), lostReasonOther: z.string().optional() }), req.body);
  if (b.status === LOST_STATUS && !b.lostReason) throw badRequest("Select a lost reason");
  const r2 = await Lead.updateMany(
    { _id: { $in: b.ids }, ...tenant(req), deletedAt: null },
    { $set: { status: b.status, lostReason: b.lostReason, lostReasonOther: b.lostReasonOther }, $push: { remarks: { at: new Date(), by: req.auth!.name, text: "Bulk status update", statusTo: b.status } } }
  );
  res.locals.item = `${r2.modifiedCount} leads`;
  res.json({ updated: r2.modifiedCount });
}));

r.post("/leads/:id/reminder", can("leads", "update"), h(async (req, res) => {
  const b = parse(z.object({ message: z.string().min(1).max(4000), webhookId: z.string().optional(), nextFollowUpAt: z.coerce.date().optional() }), req.body);
  const lead = await Lead.findOne({ _id: req.params.id, ...tenant(req), deletedAt: null });
  if (!lead) throw notFound();
  const phone = lead.whatsapp || lead.phone;
  if (!phone) throw badRequest("Lead has no WhatsApp / phone number");
  const company = await Company.findById(lead.companyId).lean<any>();
  const ctx = { phone, name: lead.name, company: company?.name, message: b.message.replace(/\{\{\s*name\s*\}\}/g, lead.name || ""), params: { lead_id: String(lead._id), status: lead.status } };
  let result: any;
  if (b.webhookId) {
    const hook = await Webhook.findOne({ _id: b.webhookId, companyId: req.auth!.companyId, active: true }).lean();
    if (!hook) throw notFound("Webhook not found or inactive");
    result = { results: await dispatch(hook, ctx, { scope: "company", companyId: req.auth!.companyId, trigger: "manual", triggeredBy: req.auth!.email }) };
  } else result = await fireEvent("company", req.auth!.companyId, "lead_reminder", ctx, "manual", req.auth!.email);
  lead.remarks.push({ by: req.auth!.name, text: `WhatsApp reminder sent: ${b.message.slice(0, 200)}` });
  if (b.nextFollowUpAt) lead.nextFollowUpAt = b.nextFollowUpAt;
  await lead.save();
  res.locals.action = "Reminder";
  res.locals.item = lead.name || phone;
  res.json(result);
}));

/** Step 1 of WhatsApp-OTP delete: send a 6-digit code to the signed-in admin's WhatsApp. */
r.post("/leads/:id/delete-otp", can("leads", "delete"), h(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...tenant(req), deletedAt: null }).lean<any>();
  if (!lead) throw notFound();
  const user = await User.findById(req.auth!.userId).lean<any>();
  const company = await Company.findById(req.auth!.companyId).lean<any>();
  const phone = user?.phone || company?.whatsapp;
  if (!phone) throw badRequest("Add your WhatsApp number to your profile to receive delete OTPs");
  const code = String(crypto.randomInt(100000, 1000000));
  await Otp.deleteMany({ userId: user._id, purpose: "lead_delete", target: String(lead._id) });
  await Otp.create({ userId: user._id, purpose: "lead_delete", target: String(lead._id), codeHash: sha256(`${code}:${user._id}`), expiresAt: new Date(Date.now() + 5 * 60_000) });
  const r2 = await fireEvent("company", req.auth!.companyId, "delete_otp", { phone, name: user.name, company: company?.name, message: `${code} is your OTP to delete lead "${lead.name || lead.phone}". Valid for 5 minutes. Do not share.`, params: { otp: code } }, "auto", req.auth!.email);
  if (!r2.sent) throw new HttpError(424, `Could not send OTP: ${r2.reason || "webhook failed"}. Create an active webhook for the "Delete OTP" event.`);
  res.locals.action = "Delete OTP sent";
  res.json({ sentTo: `••••••${String(phone).slice(-4)}`, expiresInSec: 300 });
}));

/** Step 2: verify OTP and soft-delete. */
r.post("/leads/:id/delete-confirm", can("leads", "delete"), h(async (req, res) => {
  const { otp } = parse(z.object({ otp: z.string().regex(/^\d{6}$/) }), req.body);
  const rec = await Otp.findOne({ userId: req.auth!.userId, purpose: "lead_delete", target: req.params.id, expiresAt: { $gt: new Date() } });
  if (!rec) throw badRequest("OTP expired. Request a new one.");
  if (rec.attempts >= 5) throw badRequest("Too many wrong attempts. Request a new OTP.");
  if (rec.codeHash !== sha256(`${otp}:${req.auth!.userId}`)) {
    rec.attempts += 1;
    await rec.save();
    throw badRequest("Incorrect OTP");
  }
  await rec.deleteOne();
  const lead = await Lead.findOneAndUpdate({ _id: req.params.id, ...tenant(req), deletedAt: null }, { deletedAt: new Date() });
  if (!lead) throw notFound();
  res.locals.action = "Delete (OTP verified)";
  res.locals.item = lead.name || lead.phone;
  res.json({ ok: true });
}));

/** Bulk import from .xlsx/.csv (Manual & Bulk connector). Dedupes against existing leads. */
r.post("/leads/import", can("leads", "create"), upload.single("file"), h(async (req, res) => {
  if (!req.file) throw badRequest("Attach a .xlsx or .csv file");
  if (!/\.(xlsx|xls|csv)$/i.test(req.file.originalname)) throw badRequest("Only .xlsx, .xls or .csv");
  const rows = parseSheet(req.file.buffer, req.file.originalname);
  if (!rows.length) throw badRequest("No rows found");
  if (rows.length > 5000) throw badRequest("Max 5,000 rows per file");
  const source = String(req.body.source || "bulk_import");
  const campaign = req.body.campaign ? String(req.body.campaign) : undefined;
  const out = { total: rows.length, created: 0, merged: 0, failed: 0, errors: [] as { row: number; error: string }[] };
  const batchId = randomKey(6);
  for (let i = 0; i < rows.length; i++) {
    try {
      const m = mapFields(rows[i]);
      const r2 = await upsertLead(req.auth!.companyId!, { ...m, source: m.source || source, campaign: m.campaign || campaign, customFields: { importBatch: batchId } }, { by: req.auth!.name, notify: false });
      r2.created ? out.created++ : out.merged++;
    } catch (e: any) {
      out.failed++;
      if (out.errors.length < 50) out.errors.push({ row: i + 2, error: e.message });
    }
  }
  res.locals.action = "Import";
  res.locals.item = `${req.file.originalname} (${out.created} new)`;
  res.json(out);
}));

/* ───────────── Integrations / Connectors ───────────── */
const baseUrl = (req: any) => process.env.APP_BASE_URL || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
const serializeConnector = (c: any, req: any) => ({
  ...c,
  secretEnc: undefined,
  secretMasked: maskSecret(decrypt(c.secretEnc)),
  endpoint: `${baseUrl(req)}/api/intake/${c.key}`,
  formUrl: c.type === "qr_campaign" ? `${baseUrl(req)}/f/${c.key}` : undefined,
});

r.get("/integrations", can("integrations", "read"), h(async (req, res) => {
  const list = await Connector.find(tenant(req)).sort({ createdAt: 1 }).lean();
  const failed = await IntakeEvent.aggregate([{ $match: { companyId: oid(req.auth!.companyId!), status: { $in: ["failed", "dead"] } } }, { $group: { _id: "$connectorId", n: { $sum: 1 } } }]);
  const f = Object.fromEntries(failed.map((x: any) => [String(x._id), x.n]));
  res.json({ types: CONNECTOR_TYPES, connectors: list.map((c: any) => ({ ...serializeConnector(c, req), pendingRetries: f[String(c._id)] || 0 })) });
}));

const connectorBody = z.object({
  type: z.enum(CONNECTOR_TYPES.map((t) => t.type) as [string, ...string[]]),
  name: z.string().min(2).max(100),
  defaultSource: z.string().max(60).optional(),
  defaultCampaign: z.string().max(120).optional(),
  defaultMedium: z.string().max(60).optional(),
  fieldMap: z.record(z.string()).optional(),
  secret: z.string().max(500).optional(), // API key / Meta page token / Google key; generated if blank
  active: z.boolean().optional(),
});

r.post("/integrations", can("integrations", "create"), h(async (req, res) => {
  const b = parse(connectorBody, req.body);
  const secret = b.secret || randomKey(24);
  const doc = await Connector.create({ ...b, secret: undefined, ...tenant(req), key: `${b.type.slice(0, 3)}_${randomKey(10)}`, secretEnc: encrypt(secret), verifyToken: b.type === "meta_leads" ? randomKey(12) : undefined });
  res.locals.item = doc.name;
  // the full secret is shown once, on creation
  res.status(201).json({ ...serializeConnector(doc.toObject(), req), secret });
}));

r.put("/integrations/:id", can("integrations", "update"), h(async (req, res) => {
  const b = parse(connectorBody.partial().omit({ type: true }), req.body);
  const set: any = { ...b };
  delete set.secret;
  if (b.secret) set.secretEnc = encrypt(b.secret);
  const doc = await Connector.findOneAndUpdate({ _id: req.params.id, ...tenant(req) }, { $set: set }, { new: true }).lean();
  if (!doc) throw notFound();
  res.locals.item = (doc as any).name;
  res.json(serializeConnector(doc, req));
}));

r.post("/integrations/:id/rotate", can("integrations", "update"), h(async (req, res) => {
  const secret = randomKey(24);
  const doc = await Connector.findOneAndUpdate({ _id: req.params.id, ...tenant(req) }, { secretEnc: encrypt(secret) }, { new: true }).lean();
  if (!doc) throw notFound();
  res.locals.action = "Rotate secret";
  res.json({ ...serializeConnector(doc, req), secret });
}));

r.delete("/integrations/:id", can("integrations", "delete"), h(async (req, res) => {
  const d = await Connector.findOneAndDelete({ _id: req.params.id, ...tenant(req) });
  if (!d) throw notFound();
  res.locals.item = d.name;
  res.json({ ok: true });
}));

r.get("/integrations/:id/events", can("integrations", "read"), h(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const q: any = { connectorId: req.params.id, ...tenant(req) };
  if (req.query.status) q.status = req.query.status;
  const [items, total] = await Promise.all([IntakeEvent.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), IntakeEvent.countDocuments(q)]);
  res.json({ items, total, page, limit });
}));

r.post("/integrations/events/:eventId/retry", can("integrations", "update"), h(async (req, res) => {
  const ev = await IntakeEvent.findOne({ _id: req.params.eventId, ...tenant(req) }).lean<any>();
  if (!ev) throw notFound();
  const connector = await Connector.findById(ev.connectorId).lean();
  if (!connector) throw notFound("Connector deleted");
  await IntakeEvent.updateOne({ _id: ev._id }, { status: "failed", attempts: Math.min(ev.attempts, 4) });
  res.locals.action = "Retry intake";
  res.json(await runEvent(connector, ev._id, ev.payload));
}));

/* ───────────── Users (assigned roles) ───────────── */
r.get("/users", can("roles", "read"), h(async (req, res) => {
  res.json(await User.find({ companyId: req.auth!.companyId }).select("name email phone roleId isOwner active lastLoginAt").sort({ isOwner: -1, name: 1 }).lean());
}));
r.post("/users", can("roles", "create"), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().regex(/^\d{10}$/).optional().or(z.literal("")), password: z.string().min(8), roleId: z.string() }), req.body);
  const plan = await Plan.findOne({ name: req.auth!.plan }).lean<any>();
  if (plan?.userLimit && (await User.countDocuments({ companyId: req.auth!.companyId })) >= plan.userLimit) throw new HttpError(402, `Your plan allows ${plan.userLimit} users`);
  if (!(await Role.exists({ _id: b.roleId, companyId: req.auth!.companyId }))) throw badRequest("Unknown role");
  const u = await User.create({ scope: "company", companyId: req.auth!.companyId, name: b.name, email: b.email.toLowerCase(), phone: b.phone || undefined, passwordHash: await bcrypt.hash(b.password, 12), roleId: b.roleId });
  res.locals.item = u.email;
  res.status(201).json({ _id: u._id, name: u.name, email: u.email });
}));
r.put("/users/:id", can("roles", "update"), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().optional(), phone: z.string().optional(), roleId: z.string().optional(), active: z.boolean().optional(), password: z.string().min(8).optional() }), req.body);
  const u = await User.findOne({ _id: req.params.id, companyId: req.auth!.companyId });
  if (!u) throw notFound();
  if (u.isOwner && (b.roleId || b.active === false)) throw forbidden("The company owner always keeps full access");
  const { password, ...rest } = b;
  u.set(rest);
  if (password) {
    u.passwordHash = await bcrypt.hash(password, 12);
    u.tokenVersion += 1;
  }
  if (b.active === false) u.tokenVersion += 1;
  await u.save();
  await invalidateAuth();
  res.locals.item = u.email;
  res.json({ ok: true });
}));

/* ───────────── WhatsApp → Post (broadcast) ───────────── */
r.post("/wa-post", can("wa_webhooks", "update"), upload.single("file"), h(async (req, res) => {
  const body = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body;
  const b = parse(z.object({ webhookId: z.string(), message: z.string().min(1).max(4000), leadIds: z.array(z.string()).max(1000).optional(), saveAsLeads: z.boolean().optional() }), body);
  const hook = await Webhook.findOne({ _id: b.webhookId, companyId: req.auth!.companyId, active: true }).lean<any>();
  if (!hook) throw notFound("Select an active webhook");
  const company = await Company.findById(req.auth!.companyId).lean<any>();

  type Rcpt = { phone: string; name?: string; leadId?: string };
  let recipients: Rcpt[] = [];
  if (b.leadIds?.length) {
    const leads = await Lead.find({ _id: { $in: b.leadIds }, ...tenant(req), deletedAt: null }).select("name whatsapp phone").lean();
    recipients = leads.map((l: any) => ({ phone: l.whatsapp || l.phone, name: l.name, leadId: String(l._id) })).filter((x) => x.phone);
  }
  if (req.file) {
    const rows = parseSheet(req.file.buffer, req.file.originalname).map((r2) => mapFields(r2));
    for (const row of rows) {
      const phone = row.whatsapp || row.phone;
      if (!phone) continue;
      let leadId;
      if (b.saveAsLeads) leadId = String((await upsertLead(req.auth!.companyId!, { ...row, source: row.source || "whatsapp_post" }, { by: req.auth!.name, notify: false })).lead._id);
      recipients.push({ phone, name: row.name, leadId });
    }
  }
  const seen = new Set<string>();
  recipients = recipients.filter((r2) => {
    const p = normalizePhone(r2.phone);
    if (p.length !== 10 || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  if (!recipients.length) throw badRequest("No valid recipients");
  if (recipients.length > 300) throw badRequest("Max 300 recipients per post on serverless. Split into batches.");

  let ok = 0;
  let failed = 0;
  // small concurrency pool so one slow endpoint doesn't time the function out
  const queue = [...recipients];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let rc = queue.shift(); rc; rc = queue.shift()) {
        const results = await dispatch(hook, { phone: rc.phone, name: rc.name, company: company?.name, message: b.message.replace(/\{\{\s*name\s*\}\}/g, rc.name || ""), params: { lead_id: rc.leadId } }, { scope: "company", companyId: req.auth!.companyId, trigger: "bulk", triggeredBy: req.auth!.email });
        results.every((x) => x.ok) ? ok++ : failed++;
      }
    })
  );
  res.locals.action = "Post";
  res.locals.item = `${hook.name} → ${recipients.length}`;
  res.json({ recipients: recipients.length, ok, failed });
}));

/* ───────────── AI Agents (company) ───────────── */
/** Where this company's files live in S3 (shown on the AI Agent screen). */
r.get("/storage", can("ai_agents", "read"), h(async (req, res) => {
  const company = await Company.findById(req.auth!.companyId).select("name s3Folder").lean<any>();
  const folder = company?.s3Folder || companyFolder(company?.name || "company");
  res.json({ folder, logo: `${folder}/logo`, banner: `${folder}/banner`, brain: `${folder}/brain` });
}));

/** Every active model from Super Admin › AI Agents, with its charges and this company's credit wallet. */
r.get("/ai-agents/models", can("ai_agents", "read"), h(async (req, res) => {
  const cid = new Types.ObjectId(req.auth!.companyId!);
  const agents = await AiAgent.find({ active: true }).select("name llmVersion provider companyRate tokenWeights credits").sort({ name: 1 }).lean<any[]>();
  const [wallets, providers, spend] = await Promise.all([
    Promise.all(agents.map((a) => walletFor(cid, a))),
    AiProvider.find().select("key name").lean<any[]>(),
    AiUsage.aggregate([{ $match: { companyId: cid } }, { $group: { _id: "$agentId", billed: { $sum: "$billed" }, calls: { $sum: 1 } } }]),
  ]);
  res.json(
    agents.map((a, i) => {
      const w: any = wallets[i];
      const s = spend.find((x: any) => String(x._id) === String(a._id));
      return {
        _id: a._id,
        name: a.name,
        llmVersion: a.llmVersion,
        provider: a.provider,
        providerName: providers.find((p) => p.key === a.provider)?.name || a.provider,
        companyRate: a.companyRate || 0,
        tokenWeights: { input: a.tokenWeights?.input ?? 1, output: a.tokenWeights?.output ?? 3 },
        credits: w?.credits || 0,
        used: +(w?.used || 0).toFixed(3),
        remaining: +((w?.credits || 0) - (w?.used || 0)).toFixed(3),
        spent: +(s?.billed || 0).toFixed(2),
        calls: s?.calls || 0,
      };
    })
  );
}));

r.get("/ai-agents", can("ai_agents", "read"), h(async (req, res) => {
  res.json(await CompanyAgent.find(tenant(req)).populate("agentId", "name llmVersion provider").sort({ createdAt: -1 }).lean());
}));

const caBody = z.object({
  agentId: z.string().nullish().transform((v) => v || null),
  name: z.string().min(2).max(80),
  purpose: z.string().max(500).optional(),
  systemPrompt: z.string().max(8000).optional(),
  prompts: z.array(z.object({ title: z.string().max(80), text: z.string().max(4000) })).max(20).optional(),
  active: z.boolean().optional(),
  isAssistant: z.boolean().optional(),
});
/** Only one agent per company is the floating assistant. */
async function claimAssistant(companyId: string, id: any, on?: boolean) {
  if (on) await CompanyAgent.updateMany({ companyId, _id: { $ne: id } }, { $set: { isAssistant: false } });
}

/** Knowledge base files → <Company-Name>/brain/…, extracted text → <Company-Name>/brain/_extracted/… */
async function ingest(companyId: string, files: Express.Multer.File[]) {
  if (!files.length) return [];
  await relayoutCompany(companyId).catch(() => undefined); // older files → <Company Name>/…
  const company = await Company.findById(companyId);
  const brain = `${await folderFor(company)}/brain`;
  const out = [];
  for (const f of files) {
    const ext = f.originalname.toLowerCase().split(".").pop() || "";
    if (!KB_EXTENSIONS.includes(ext)) throw badRequest(`Unsupported file: ${f.originalname}`);
    const stored = await putObject(brain, f.originalname, f.buffer, f.mimetype);
    const text = await extractText(f.buffer, f.originalname).catch(() => "");
    const extracted = text ? await putObject(`${brain}/_extracted`, `${f.originalname}.txt`, text, "text/plain; charset=utf-8") : undefined;
    out.push({ fileName: f.originalname, key: stored.key, url: stored.url, size: f.size, mime: f.mimetype, chars: text.length, extractedKey: extracted?.key });
  }
  return out;
}

r.post("/ai-agents", can("ai_agents", "create"), upload.array("files", 10), h(async (req, res) => {
  const b = parse(caBody, typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body);
  if (b.agentId && !(await AiAgent.exists({ _id: b.agentId, active: true }))) throw badRequest("This AI model is no longer offered");
  const knowledge = await ingest(req.auth!.companyId!, (req.files as Express.Multer.File[]) || []);
  const doc = await CompanyAgent.create({ ...b, ...tenant(req), knowledge });
  await claimAssistant(req.auth!.companyId!, doc._id, b.isAssistant);
  res.locals.item = doc.name;
  res.status(201).json(doc);
}));

r.put("/ai-agents/:id", can("ai_agents", "update"), upload.array("files", 10), h(async (req, res) => {
  const data = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body;
  const b = parse(caBody.partial().extend({ removeKeys: z.array(z.string()).optional() }), data);
  const doc = await CompanyAgent.findOne({ _id: req.params.id, ...tenant(req) });
  if (!doc) throw notFound();
  const { removeKeys, ...rest } = b;
  if (rest.agentId && !(await AiAgent.exists({ _id: rest.agentId, active: true }))) throw badRequest("This AI model is no longer offered");
  doc.set(rest);
  if (removeKeys?.length) {
    for (const k of doc.knowledge.filter((x: any) => removeKeys.includes(x.key))) {
      await deleteObject(k.key);
      if (k.extractedKey) await deleteObject(k.extractedKey);
    }
    doc.knowledge = doc.knowledge.filter((x: any) => !removeKeys.includes(x.key));
  }
  doc.knowledge.push(...(await ingest(req.auth!.companyId!, (req.files as Express.Multer.File[]) || [])));
  await doc.save();
  await claimAssistant(req.auth!.companyId!, doc._id, b.isAssistant);
  res.locals.item = doc.name;
  res.json(doc);
}));

/** Usage history of one company agent: totals, daily trend, by purpose, and the latest calls (paged). */
r.get("/ai-agents/:id/usage", can("ai_agents", "read"), h(async (req, res) => {
  const cid = new Types.ObjectId(req.auth!.companyId!);
  const ca = await CompanyAgent.findOne({ _id: req.params.id, companyId: cid }).populate("agentId", "name llmVersion provider companyRate tokenWeights credits active").lean<any>();
  if (!ca) throw notFound();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 25;
  const match = { companyId: cid, companyAgentId: ca._id };
  const since = new Date(Date.now() - 29 * 86400_000);
  since.setHours(0, 0, 0, 0);
  const model: any = ca.agentId;
  const [totals, byPurpose, daily, rows, total, wallet] = await Promise.all([
    AiUsage.aggregate([{ $match: match }, { $group: { _id: null, calls: { $sum: 1 }, inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, credits: { $sum: "$credits" }, billed: { $sum: "$billed" }, first: { $min: "$createdAt" }, last: { $max: "$createdAt" } } }]),
    AiUsage.aggregate([{ $match: match }, { $group: { _id: "$purpose", calls: { $sum: 1 }, credits: { $sum: "$credits" }, billed: { $sum: "$billed" } } }, { $sort: { billed: -1 } }]),
    AiUsage.aggregate([
      { $match: { ...match, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, calls: { $sum: 1 }, credits: { $sum: "$credits" }, billed: { $sum: "$billed" } } },
      { $sort: { _id: 1 } },
    ]),
    AiUsage.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("-cost").lean<any[]>(),
    AiUsage.countDocuments(match),
    model?._id ? walletFor(cid, model) : null,
  ]);
  const users = await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.userId)).filter(Boolean))] } }).select("name email").lean<any[]>();
  const t = totals[0] || { calls: 0, inputTokens: 0, outputTokens: 0, credits: 0, billed: 0 };
  res.json({
    agent: { _id: ca._id, name: ca.name, isAssistant: !!ca.isAssistant },
    model: model ? { name: model.name, llmVersion: model.llmVersion, companyRate: model.companyRate || 0, tokenWeights: model.tokenWeights || { input: 1, output: 3 } } : null,
    wallet: wallet ? { credits: wallet.credits || 0, used: +(wallet.used || 0).toFixed(3), remaining: +((wallet.credits || 0) - (wallet.used || 0)).toFixed(3) } : null,
    totals: { calls: t.calls, inputTokens: t.inputTokens, outputTokens: t.outputTokens, credits: +t.credits.toFixed(3), billed: +t.billed.toFixed(2), first: t.first, last: t.last },
    byPurpose: byPurpose.map((x: any) => ({ purpose: x._id || "chat", calls: x.calls, credits: +x.credits.toFixed(3), billed: +x.billed.toFixed(2) })),
    daily: daily.map((x: any) => ({ day: x._id, calls: x.calls, credits: +x.credits.toFixed(3), billed: +x.billed.toFixed(2) })),
    rows: rows.map((r) => ({ _id: r._id, at: r.createdAt, purpose: r.purpose || "chat", user: users.find((u) => String(u._id) === String(r.userId))?.name || "—", inputTokens: r.inputTokens || 0, outputTokens: r.outputTokens || 0, credits: +(r.credits || 0).toFixed(3), billed: +(r.billed || 0).toFixed(2) })),
    page,
    limit,
    total,
  });
}));

r.delete("/ai-agents/:id", can("ai_agents", "delete"), h(async (req, res) => {
  const d = await CompanyAgent.findOneAndDelete({ _id: req.params.id, ...tenant(req) });
  if (!d) throw notFound();
  for (const k of d.knowledge) {
    await deleteObject(k.key);
    if (k.extractedKey) await deleteObject(k.extractedKey);
  }
  res.locals.item = d.name;
  res.json({ ok: true });
}));

r.post("/ai-agents/:id/chat", can("ai_agents", "read"), h(async (req, res) => {
  const b = parse(z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(30) }), req.body);
  const ca = await CompanyAgent.findOne({ _id: req.params.id, ...tenant(req) }).lean<any>();
  if (!ca) throw notFound();
  if (!ca.agentId) throw badRequest("Pick an AI model for this agent first (allocated by your Super Admin).");
  const agent = await AiAgent.findOne({ _id: ca.agentId, active: true }).lean();
  if (!agent) throw badRequest("Underlying AI model is unavailable");
  res.locals.logRead = true;
  res.locals.action = "AI chat";
  res.locals.item = ca.name;
  res.json(await chat({ agent, companyAgent: ca, companyId: req.auth!.companyId!, messages: b.messages, userId: req.auth!.userId }));
}));

/* ───────────── Floating AI assistant (read-only) ───────────── */
r.get("/assistant", h(async (req, res) => {
  const info = await assistantInfo(req.auth!.companyId!);
  const company = await Company.findById(req.auth!.companyId).lean<any>();
  const b = company ? publicBranding(company) : null;
  res.json({ ...info, name: info.name || `${b?.shortName || company?.name || "Company"} Assistant`, logoUrl: b?.logoUrl, canSetup: !!req.auth!.perms?.ai_agents?.create });
}));
r.post("/assistant/chat", h(async (req, res) => {
  const b = parse(z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).min(1).max(30) }), req.body);
  if (!(await rateLimit(`assistant:${req.auth!.userId}`, 30, 60))) throw new HttpError(429, "You're asking very fast — give it a few seconds");
  res.locals.module = "assistant";
  res.locals.logRead = true;
  res.locals.action = "Assistant question";
  res.locals.item = b.messages[b.messages.length - 1].content.slice(0, 80);
  res.json(await assistantChat(req.auth!, b.messages));
}));

r.use("/reports", reportRoutes("company"));
r.use("/roles", roleRoutes("company"));
r.use("/activity-logs", activityRoutes("company"));
r.use("/webhooks", webhookRoutes("company"));
r.use("/wa-logs", waLogRoutes("company"));

export default r;

/**
 * Super Admin › Company workspace — everything behind the tabs on one company's page.
 *
 * The company record itself (details, subscription plan, login, branding, modules, white label, notifications)
 * is saved by PUT /sa/companies/:id in index.ts, exactly as before. The endpoints here are the ones that read
 * or write something that is NOT part of that record: the live figures, the company's roles (which live in the
 * company's own database), its background-job schedules, its retention periods and its storage.
 */
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { Company, User, Role, Lead, SupportTicket, ClientPayment, Connector, IntakeEvent, Subscription, SubscriptionCycle, AiAllocation, ServiceType } from "../../models";
import { can } from "../../middleware/auth";
import { h, parse, notFound, badRequest, HttpError } from "../../lib/http";
import { inCompanyDb } from "../../lib/tenantdb";
import { jobRows, saveCron, runFor } from "../../lib/cron";
import { retentionRows, applyRetention, saveRetention } from "../../lib/retention";
import { clampToPlan } from "../shared";
import { companyCaps } from "../../middleware/auth";
import { COMPANY_MODULES, ACTIONS, permRows, type PermMap } from "../../../shared/constants";
import { CRON_JOBS, LOG_KINDS, NOTIFY_KINDS, NOTIFY_SOUNDS, cronJob, s3Area } from "../../../shared/platform";
import { SITE_SECTIONS, startingSite } from "../../../shared/site";
import { putAt, deleteObject, companyFolder, listPrefix } from "../../lib/s3";
import { tenantUrls } from "../../lib/tenant";
import { endOfToday } from "../../lib/clients";
import { WON_STATUS } from "../../../shared/constants";

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

async function load(req: any) {
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null }).lean<any>();
  if (!c) throw notFound("Company not found");
  return c;
}

/* ───────────────────────── Overview ───────────────────────── */

/** The figures on the company's Overview tab — this platform's own measures, not a shop's. */
r.get("/companies/:id/overview", can("companies", "read"), h(async (req, res) => {
  const c = await load(req);
  const since = new Date(Date.now() - 7 * 86400_000);
  const until = endOfToday();

  const [users, owner, allocations, sub, cycle] = await Promise.all([
    User.find({ companyId: c._id, deletedAt: null }).select("name email roleId isOwner lastLoginAt status").sort({ isOwner: -1, name: 1 }).limit(50).lean<any[]>(),
    User.findOne({ companyId: c._id, isOwner: true }).select("email name").lean<any>(),
    AiAllocation.find({ companyId: c._id }).lean<any[]>(),
    Subscription.findOne({ companyId: c._id, active: true }).lean<any>(),
    SubscriptionCycle.findOne({ companyId: c._id }).sort({ periodStart: -1 }).lean<any>(),
  ]);

  const inside = await inCompanyDb(String(c._id), async () => {
    const base = { companyId: c._id, deletedAt: null };
    const [leads7, leadsTotal, won7, clients, openTickets, connectors, liveConnectors, stuck, payments] = await Promise.all([
      Lead.countDocuments({ ...base, createdAt: { $gte: since } }),
      Lead.countDocuments(base),
      Lead.countDocuments({ ...base, status: WON_STATUS, updatedAt: { $gte: since } }),
      Lead.countDocuments({ ...base, isClient: true }),
      SupportTicket.countDocuments({ companyId: c._id, status: { $nin: ["Resolved", "Closed"] } }),
      Connector.countDocuments({ companyId: c._id }),
      Connector.countDocuments({ companyId: c._id, active: true }),
      IntakeEvent.countDocuments({ companyId: c._id, status: { $in: ["failed", "dead"] } }),
      ClientPayment.find({ companyId: c._id, status: { $ne: "paid" } }).select("gross dueDate").limit(5000).lean<any[]>(),
    ]);
    const outstanding = payments.filter((p) => new Date(p.dueDate) <= until).reduce((a, p) => a + (p.gross || 0), 0);
    const upcoming = payments.filter((p) => new Date(p.dueDate) > until).reduce((a, p) => a + (p.gross || 0), 0);
    const recent = await Lead.find(base).sort({ createdAt: -1 }).limit(5).select("name companyName source status createdAt").lean<any[]>();
    return { leads7, leadsTotal, won7, clients, openTickets, connectors, liveConnectors, stuck, outstanding, upcoming, recent };
  });

  res.json({
    ...inside,
    users: users.map((u) => ({ ...u, isOwner: !!u.isOwner })),
    userCount: users.length,
    loginEmail: owner?.email,
    aiCredits: allocations.reduce((a, x) => a + (x.credits || 0), 0),
    subscription: sub ? { planName: sub.planName, frequency: sub.frequency, amount: sub.amount, discountType: sub.discountType, discountValue: sub.discountValue } : null,
    cycle: cycle ? { periodStart: cycle.periodStart, periodEnd: cycle.periodEnd, status: cycle.status, systemAmount: cycle.systemAmount, discount: cycle.discount } : null,
    ...tenantUrls(c),
  });
}));

/* ───────────────────────── Role access ─────────────────────────
 * The company's own roles live in the company's database. Super Admin edits them here within the plan and the
 * company's module overrides, exactly as the company's own Role Management would — so nothing can be granted
 * that the plan or a paused module does not allow.
 */

r.get("/companies/:id/roles", can("companies", "read"), h(async (req, res) => {
  const c = await load(req);
  const [roles, caps] = await Promise.all([
    inCompanyDb(String(c._id), () => Role.find({ scope: "company", companyId: c._id }).sort({ name: 1 }).lean<any[]>()),
    companyCaps(c.plan, c.moduleAccess),
  ]);
  const counts = await User.aggregate([{ $match: { companyId: c._id, deletedAt: null } }, { $group: { _id: "$roleId", n: { $sum: 1 } } }]).catch(() => [] as any[]);
  const byRole = new Map(counts.map((x: any) => [String(x._id), x.n]));
  res.json({
    roles: roles.map((x) => ({ ...x, users: byRole.get(String(x._id)) || 0 })),
    modules: COMPANY_MODULES,
    rows: permRows(COMPANY_MODULES),
    planCaps: caps.caps,
    paused: caps.paused,
    plan: c.plan,
  });
}));

const permSchema = z.record(z.string().max(60), z.object({ create: z.boolean(), read: z.boolean(), update: z.boolean(), delete: z.boolean() }));

r.post("/companies/:id/roles", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  const b = parse(z.object({ name: z.string().min(2).max(60), permissions: permSchema.default({}) }), req.body);
  const permissions = await clampToPlan(c.plan, b.permissions as PermMap, c.moduleAccess);
  const role = await inCompanyDb(String(c._id), () => Role.create({ scope: "company", companyId: c._id, name: b.name, plan: c.plan, permissions, setBy: "super" }));
  res.locals.action = "Create role";
  res.locals.item = `${c.name} › ${b.name}`;
  res.status(201).json(role);
}));

r.put("/companies/:id/roles/:roleId", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  const b = parse(z.object({ name: z.string().min(2).max(60).optional(), permissions: permSchema.optional() }), req.body);
  const permissions = b.permissions ? await clampToPlan(c.plan, b.permissions as PermMap, c.moduleAccess) : undefined;
  const role = await inCompanyDb(String(c._id), async () => {
    const x = await Role.findOne({ _id: req.params.roleId, scope: "company", companyId: c._id });
    if (!x) throw notFound("Role not found");
    if (b.name) x.name = b.name;
    if (permissions) {
      x.permissions = permissions;
      x.markModified("permissions");
    }
    x.setBy = "super"; // saving here makes Super Admin the one who sets it
    await x.save();
    return x.toObject();
  });
  res.locals.action = "Update role";
  res.locals.item = `${c.name} › ${role.name}`;
  res.json(role);
}));

r.delete("/companies/:id/roles/:roleId", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  await inCompanyDb(String(c._id), async () => {
    if (await User.exists({ companyId: c._id, roleId: req.params.roleId, deletedAt: null })) throw badRequest("Move this role's users to another role first");
    await Role.deleteOne({ _id: req.params.roleId, scope: "company", companyId: c._id });
  });
  res.locals.action = "Delete role";
  res.json({ ok: true });
}));

/* ───────────────────────── Cron Jobs ───────────────────────── */

r.get("/companies/:id/cron", can("companies", "read"), h(async (req, res) => {
  const c = await load(req);
  res.json({ jobs: await jobRows(c), note: "A change applies at once — each job checks this company's schedule on its next beat." });
}));

r.put("/companies/:id/cron", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  const b = parse(z.object({ cron: z.record(z.string().max(40), z.object({ on: z.boolean().optional(), unit: z.enum(["minutes", "hours", "daily"]).optional(), every: z.number().int().min(1).max(1440).optional(), at: z.string().regex(/^\d{2}:\d{2}$/).optional() })) }), req.body);
  const saved = await saveCron(c._id, b.cron);
  res.locals.action = "Update job schedules";
  res.locals.item = c.name;
  res.json({ cron: saved, jobs: await jobRows({ ...c, cron: saved }) });
}));

/** Run now — does this company's share of a job straight away, outside its schedule. */
r.post("/companies/:id/cron/:job/run", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  const def = cronJob(req.params.job);
  if (!def) throw notFound("Unknown job");
  const { runJobForCompany } = await import("../../lib/cronjobs");
  const out = await runFor(def.key, c, () => runJobForCompany(def.key, c), { force: true, by: req.auth!.email });
  res.locals.action = "Run job";
  res.locals.item = `${c.name} › ${def.label}`;
  res.json({ ok: true, result: out, jobs: await jobRows(c) });
}));

/* ───────────────────────── Retention Policy ───────────────────────── */

r.get("/companies/:id/retention", can("companies", "read"), h(async (req, res) => {
  const c = await load(req);
  res.json({ rows: await retentionRows(c), choices: LOG_KINDS.map((k) => k.key) });
}));

r.put("/companies/:id/retention", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  const b = parse(z.object({ retention: z.record(z.string().max(40), z.number().int().min(0).max(3650)) }), req.body);
  const saved = await saveRetention(c._id, b.retention);
  res.locals.action = "Update retention";
  res.locals.item = c.name;
  res.json({ retention: saved, rows: await retentionRows({ ...c, retention: saved }) });
}));

r.post("/companies/:id/retention/apply", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  const only = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const removed = await applyRetention(c, only);
  res.locals.action = "Apply retention";
  res.locals.item = `${c.name}${only ? ` › ${only}` : ""}`;
  res.json({ removed, rows: await retentionRows(c) });
}));

/* ───────────────────────── Storage (S3) ───────────────────────── */

/** What the company's prefix holds, area by area — branding, app builds, AI knowledge, client attachments. */
r.get("/companies/:id/storage", can("companies", "read"), h(async (req, res) => {
  const c = await load(req);
  if (c.s3Enabled === false) return res.json({ enabled: false, folder: null, areas: [] });
  const folder = companyFolder(c.code);
  const areas = await Promise.all(
    (["branding", "sounds", "app", "brain", "dpdp"] as const).map(async (area) => {
      const prefix = s3Area(c.code, area);
      const got = await listPrefix(prefix).catch(() => ({ files: 0, bytes: 0, items: [] as any[] }));
      return { area, prefix, ...got };
    })
  );
  res.json({ enabled: true, folder, createdAt: c.s3CreatedAt, areas });
}));

/* ───────────────────────── Notification sounds ───────────────────────── */

/** The company's own alert sounds, kept beside its branding so the apps can play them. */
r.post("/companies/:id/sound", can("companies", "update"), upload.single("file"), h(async (req: any, res) => {
  const c = await load(req);
  if (c.s3Enabled === false) throw badRequest("Switch on S3 storage for this company first");
  if (!req.file) throw badRequest("Choose a sound file");
  const ext = (req.file.originalname.split(".").pop() || "mp3").toLowerCase();
  if (!["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "webm", "flac"].includes(ext)) throw badRequest("Use MP3, WAV, M4A, AAC, OGG, OPUS, WEBM or FLAC");
  const name = req.file.originalname.replace(/\.[^.]+$/, "").slice(0, 40);
  const path = `${s3Area(c.code, "sounds", ext)}/${Date.now()}-${name.replace(/[^a-zA-Z0-9-_]+/g, "-")}.${ext}`;
  const { key } = await putAt(path, req.file.buffer, req.file.mimetype || `audio/${ext}`);
  const sounds = [...(c.branding?.sounds || []), { key, name, format: ext, size: req.file.size, at: new Date() }].slice(-25);
  await Company.updateOne({ _id: c._id }, { $set: { "branding.sounds": sounds } });
  res.locals.action = "Upload sound";
  res.locals.item = `${c.name} › ${name}`;
  res.status(201).json({ sounds });
}));

r.delete("/companies/:id/sound", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  const key = String(req.query.key || "");
  if (!key.startsWith(`${c.code.toUpperCase()}/`)) throw badRequest("Not this company's file");
  await deleteObject(key).catch(() => {});
  const sounds = (c.branding?.sounds || []).filter((s: any) => s.key !== key);
  await Company.updateOne({ _id: c._id }, { $set: { "branding.sounds": sounds } });
  res.locals.action = "Delete sound";
  res.json({ sounds });
}));

/* ───────────────────────── Website ─────────────────────────
 * The company's own small site. Stored on the Company as `site`; the public page reads the same shape.
 */

r.get("/companies/:id/site", can("companies", "read"), h(async (req, res) => {
  const c = await load(req);
  const site = c.site && Object.keys(c.site).length ? c.site : startingSite(c);
  const services = await inCompanyDb(String(c._id), () => ServiceType.find({ companyId: c._id }).select("name").sort({ name: 1 }).limit(50).lean<any[]>()).catch(() => []);
  const urls = tenantUrls(c);
  res.json({ site, sections: SITE_SECTIONS, services: services.map((s: any) => s.name), url: `${urls.customUrl || urls.platformUrl}/site`, branding: { themeColor: c.branding?.themeColor, accentColor: c.branding?.accentColor } });
}));

r.put("/companies/:id/site", can("companies", "update"), h(async (req, res) => {
  const c = await load(req);
  const b = parse(z.object({ published: z.boolean().optional(), sections: z.record(z.string().max(40), z.any()) }), req.body);
  const keys = new Set(SITE_SECTIONS.map((s) => s.key));
  const sections: Record<string, any> = {};
  for (const [k, v] of Object.entries(b.sections || {})) if (keys.has(k) && v && typeof v === "object") sections[k] = v;
  const site = { ...(c.site || {}), published: b.published ?? c.site?.published ?? false, sections, updatedAt: new Date(), updatedBy: req.auth!.email };
  await Company.updateOne({ _id: c._id }, { $set: { site } });
  res.locals.action = "Update website";
  res.locals.item = c.name;
  res.json({ site });
}));

/* ───────────────────────── Registries the tabs render from ───────────────────────── */

r.get("/platform/registries", can("companies", "read"), h(async (_req, res) => {
  res.json({ cron: CRON_JOBS, logs: LOG_KINDS, notifications: NOTIFY_KINDS, sounds: NOTIFY_SOUNDS, modules: COMPANY_MODULES, rows: permRows(COMPANY_MODULES) });
}));

export default r;

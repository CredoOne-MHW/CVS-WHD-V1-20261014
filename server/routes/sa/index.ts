import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Company, User, Plan, Lead, WaLog, AiAgent, AiAllocation, AiUsage, Connector } from "../../models";
import { can, requireScope } from "../../middleware/auth";
import { h, parse, notFound, badRequest, paging, escapeRegex } from "../../lib/http";
import { encrypt } from "../../lib/crypto";
import { fireEvent } from "../../lib/whatsapp";
import { webhookRoutes, waLogRoutes, activityRoutes, roleRoutes } from "../shared";
import { COMPANY_MODULES, PLAN_TIERS, ACTIONS, type PermMap } from "../../../shared/constants";

const r = Router();
r.use(requireScope("super"));

/* ───────────── Dashboard ───────────── */
r.get("/dashboard", can("dashboard", "read"), h(async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [byPlan, byStatus, leads30, totalLeads, wa, credits, recent, trend] = await Promise.all([
    Company.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$plan", n: { $sum: 1 } } }]),
    Company.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Lead.countDocuments({ createdAt: { $gte: since }, deletedAt: null }),
    Lead.estimatedDocumentCount(),
    WaLog.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$result", n: { $sum: 1 } } }]),
    AiUsage.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, credits: { $sum: "$credits" }, cost: { $sum: "$cost" }, billed: { $sum: "$billed" } } }]),
    Company.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(6).select("name code plan status createdAt").lean(),
    Lead.aggregate([
      { $match: { createdAt: { $gte: since }, deletedAt: null } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const topCompanies = await Lead.aggregate([
    { $match: { createdAt: { $gte: since }, deletedAt: null } },
    { $group: { _id: "$companyId", leads: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ["$status", "Converted / Service Initiated"] }, 1, 0] } } } },
    { $sort: { leads: -1 } },
    { $limit: 5 },
    { $lookup: { from: "companies", localField: "_id", foreignField: "_id", as: "c" } },
    { $project: { leads: 1, won: 1, name: { $first: "$c.name" } } },
  ]);
  res.json({ byPlan, byStatus, leads30, totalLeads, wa, ai: credits[0] || { credits: 0, cost: 0, billed: 0 }, recent, trend, topCompanies });
}));

/* ───────────── Companies ───────────── */
const companyBody = z.object({
  name: z.string().min(2).max(150),
  code: z.string().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
  contactPerson: z.string().max(100).optional(),
  phone: z.string().regex(/^\d{10}$/, "10-digit number").optional().or(z.literal("")),
  whatsapp: z.string().regex(/^\d{10}$/, "10-digit number without +91").optional().or(z.literal("")),
  email: z.string().email(),
  plan: z.string().min(1).default(PLAN_TIERS[0]),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN").optional().or(z.literal("")),
  address: z.string().max(500).optional(),
  loginEmail: z.string().email().optional().or(z.literal("")),
  password: z.string().min(8, "Min 8 characters").optional(),
});

r.get("/companies", can("companies", "read"), h(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const q: any = { deletedAt: null };
  if (req.query.q) q.$or = ["name", "code", "email", "contactPerson"].map((f) => ({ [f]: { $regex: escapeRegex(String(req.query.q)), $options: "i" } }));
  if (req.query.plan) q.plan = req.query.plan;
  if (req.query.status) q.status = req.query.status;
  const [items, total] = await Promise.all([Company.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Company.countDocuments(q)]);
  const owners = await User.find({ companyId: { $in: items.map((c: any) => c._id) }, isOwner: true }).select("companyId email").lean();
  const loginBy = Object.fromEntries(owners.map((o: any) => [String(o.companyId), o.email]));
  res.json({ items: items.map((c: any) => ({ ...c, loginEmail: loginBy[String(c._id)] })), total, page, limit });
}));

r.get("/companies/:id", can("companies", "read"), h(async (req, res) => {
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null }).lean<any>();
  if (!c) throw notFound();
  const [owner, allocations, leadCount, connectors] = await Promise.all([
    User.findOne({ companyId: c._id, isOwner: true }).select("email name").lean<any>(),
    AiAllocation.find({ companyId: c._id }).lean(),
    Lead.countDocuments({ companyId: c._id, deletedAt: null }),
    Connector.countDocuments({ companyId: c._id }),
  ]);
  res.json({ ...c, loginEmail: owner?.email, allocations, leadCount, connectors });
}));

r.post("/companies", can("companies", "create"), h(async (req, res) => {
  const b = parse(companyBody.required({ password: true }), req.body);
  const loginEmail = (b.loginEmail || b.email).toLowerCase();
  if (!(await Plan.exists({ name: b.plan }))) throw badRequest("Unknown plan");
  if (await User.exists({ email: loginEmail })) throw badRequest("Login email is already used by another account");
  const company = await Company.create({ ...b, code: b.code.toUpperCase(), loginEmail: undefined, password: undefined, trialEndsAt: b.plan === "Trial" ? new Date(Date.now() + 14 * 86400_000) : undefined });
  try {
    await User.create({ scope: "company", companyId: company._id, name: b.contactPerson || b.name, email: loginEmail, phone: b.whatsapp || b.phone, passwordHash: await bcrypt.hash(b.password, 12), isOwner: true });
  } catch (e) {
    await Company.deleteOne({ _id: company._id });
    throw e;
  }
  res.locals.item = company.name;
  if (b.whatsapp) fireEvent("super", undefined, "company_created", { phone: b.whatsapp, name: b.contactPerson, company: b.name, message: `Welcome to LeadHive, ${b.contactPerson || b.name}! Your ${b.plan} workspace is ready. Login: ${loginEmail}` }).catch(() => undefined);
  res.status(201).json(company);
}));

r.put("/companies/:id", can("companies", "update"), h(async (req, res) => {
  const b = parse(companyBody.partial(), req.body);
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null });
  if (!c) throw notFound();
  const { loginEmail, password, ...rest } = b;
  c.set({ ...rest, code: rest.code ? rest.code.toUpperCase() : c.code });
  await c.save();
  const owner = await User.findOne({ companyId: c._id, isOwner: true });
  if (owner) {
    if (loginEmail && loginEmail.toLowerCase() !== owner.email) {
      if (await User.exists({ email: loginEmail.toLowerCase() })) throw badRequest("Login email already in use");
      owner.email = loginEmail.toLowerCase();
    }
    if (password) {
      owner.passwordHash = await bcrypt.hash(password, 12);
      owner.tokenVersion += 1;
    }
    await owner.save();
  }
  res.locals.item = c.name;
  res.json(c);
}));

r.post("/companies/:id/status", can("companies", "update"), h(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["active", "inactive"]) }), req.body);
  const c = await Company.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, { status }, { new: true });
  if (!c) throw notFound();
  if (status === "inactive") await User.updateMany({ companyId: c._id }, { $inc: { tokenVersion: 1 } }); // kick sessions
  res.locals.action = status === "active" ? "Activate" : "Deactivate";
  res.locals.item = c.name;
  if (status === "inactive" && c.whatsapp) fireEvent("super", undefined, "company_deactivated", { phone: c.whatsapp, name: c.contactPerson ?? undefined, company: c.name, message: `Your LeadHive workspace for ${c.name} has been deactivated. Please contact support.` }).catch(() => undefined);
  res.json(c);
}));

r.post("/companies/:id/reminder", can("companies", "update"), h(async (req, res) => {
  const { message } = parse(z.object({ message: z.string().min(1).max(4000) }), req.body);
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null }).lean<any>();
  if (!c) throw notFound();
  const phone = c.whatsapp || c.phone;
  if (!phone) throw badRequest("Company has no WhatsApp number");
  res.locals.action = "Reminder";
  res.locals.item = c.name;
  res.json(await fireEvent("super", undefined, "company_reminder", { phone, name: c.contactPerson, company: c.name, message, params: { plan: c.plan, code: c.code } }, "manual", req.auth!.email));
}));

r.delete("/companies/:id", can("companies", "delete"), h(async (req, res) => {
  const c = await Company.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, { deletedAt: new Date(), status: "inactive", code: `DEL-${Date.now()}` });
  if (!c) throw notFound();
  await User.updateMany({ companyId: c._id }, { active: false, $inc: { tokenVersion: 1 }, $set: { email: undefined } }).catch(() => undefined);
  await User.deleteMany({ companyId: c._id }); // frees login emails; data stays (soft-deleted company) for audit
  res.locals.item = c.name;
  res.json({ ok: true });
}));

/** AI credit allocation for a company (Company → AI Agents). */
r.put("/companies/:id/ai", can("companies", "update"), h(async (req, res) => {
  const b = parse(z.array(z.object({ agentId: z.string(), credits: z.coerce.number().min(0) })), req.body);
  for (const a of b) await AiAllocation.updateOne({ companyId: req.params.id, agentId: a.agentId }, { $set: { credits: a.credits } }, { upsert: true });
  res.locals.module = "companies";
  res.locals.item = `AI allocation ${req.params.id}`;
  res.json(await AiAllocation.find({ companyId: req.params.id }).lean());
}));

/* ───────────── AI Agents (platform models) ───────────── */
const agentBody = z.object({
  name: z.string().min(2).max(80),
  llmVersion: z.string().min(2).max(80),
  provider: z.enum(["anthropic", "openai", "google", "openai-compatible"]),
  url: z.string().url().optional().or(z.literal("")),
  apiKey: z.string().optional(),
  tokenWeights: z.object({ input: z.coerce.number().min(0), output: z.coerce.number().min(0) }),
  actualRate: z.coerce.number().min(0),
  companyRate: z.coerce.number().min(0),
  credits: z.coerce.number().min(0),
  active: z.boolean().default(true),
});

r.get("/ai-agents", can("ai_agents", "read"), h(async (_req, res) => {
  const items = await AiAgent.find().sort({ createdAt: -1 }).select("-apiKeyEnc").lean();
  const usage = await AiAllocation.aggregate([{ $group: { _id: "$agentId", allocated: { $sum: "$credits" }, used: { $sum: "$used" }, companies: { $sum: 1 } } }]);
  const u = Object.fromEntries(usage.map((x: any) => [String(x._id), x]));
  res.json(items.map((a: any) => ({ ...a, allocated: u[String(a._id)]?.allocated || 0, used: u[String(a._id)]?.used || 0, companies: u[String(a._id)]?.companies || 0, margin: a.companyRate - a.actualRate })));
}));
r.post("/ai-agents", can("ai_agents", "create"), h(async (req, res) => {
  const b = parse(agentBody, req.body);
  const doc = await AiAgent.create({ ...b, apiKeyEnc: encrypt(b.apiKey), apiKey: undefined });
  res.locals.item = doc.name;
  res.status(201).json({ ...doc.toObject(), apiKeyEnc: undefined });
}));
r.put("/ai-agents/:id", can("ai_agents", "update"), h(async (req, res) => {
  const b = parse(agentBody.partial(), req.body);
  const set: any = { ...b };
  delete set.apiKey;
  if (b.apiKey) set.apiKeyEnc = encrypt(b.apiKey);
  const doc = await AiAgent.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).select("-apiKeyEnc");
  if (!doc) throw notFound();
  res.locals.item = doc.name;
  res.json(doc);
}));
r.delete("/ai-agents/:id", can("ai_agents", "delete"), h(async (req, res) => {
  const d = await AiAgent.findByIdAndDelete(req.params.id);
  if (!d) throw notFound();
  res.locals.item = d.name;
  res.json({ ok: true });
}));

/* ───────────── Plans ───────────── */
r.get("/plans", can("plans", "read"), h(async (_req, res) => {
  const plans = await Plan.find().sort({ priceMonthly: 1, createdAt: 1 }).lean();
  const counts = await Company.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$plan", n: { $sum: 1 } } }]);
  const c = Object.fromEntries(counts.map((x: any) => [x._id, x.n]));
  // Any module added to COMPANY_MODULES shows up here automatically (unchecked until granted).
  res.json({ modules: COMPANY_MODULES, plans: plans.map((p: any) => ({ ...p, companies: c[p.name] || 0 })) });
}));
const planBody = z.object({
  name: z.string().min(2).max(40),
  description: z.string().max(300).optional(),
  priceMonthly: z.coerce.number().min(0).default(0),
  leadLimit: z.coerce.number().min(0).default(0),
  userLimit: z.coerce.number().min(0).default(0),
  permissions: z.record(z.object({ create: z.boolean(), read: z.boolean(), update: z.boolean(), delete: z.boolean() })).default({}),
});
const cleanPerms = (p: PermMap) => Object.fromEntries(COMPANY_MODULES.map((m) => [m.key, Object.fromEntries(ACTIONS.map((a) => [a, !!p[m.key]?.[a]]))]));
r.post("/plans", can("plans", "create"), h(async (req, res) => {
  const b = parse(planBody, req.body);
  const doc = await Plan.create({ ...b, permissions: cleanPerms(b.permissions as PermMap) });
  res.locals.item = doc.name;
  res.status(201).json(doc);
}));
r.put("/plans/:id", can("plans", "update"), h(async (req, res) => {
  const b = parse(planBody.partial(), req.body);
  const set: any = { ...b };
  if (b.permissions) set.permissions = cleanPerms(b.permissions as PermMap);
  const doc = await Plan.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
  if (!doc) throw notFound();
  res.locals.item = doc.name;
  res.json(doc);
}));
r.delete("/plans/:id", can("plans", "delete"), h(async (req, res) => {
  const p = await Plan.findById(req.params.id);
  if (!p) throw notFound();
  if (await Company.exists({ plan: p.name, deletedAt: null })) throw badRequest("Plan is in use by companies");
  await p.deleteOne();
  res.locals.item = p.name;
  res.json({ ok: true });
}));

r.get("/companies-lite", can("activity_logs", "read"), h(async (_req, res) => {
  res.json(await Company.find({ deletedAt: null }).select("name code").sort({ name: 1 }).lean());
}));

r.use("/roles", roleRoutes("super"));
r.use("/activity-logs", activityRoutes("super"));
r.use("/webhooks", webhookRoutes("super"));
r.use("/wa-logs", waLogRoutes("super"));

export default r;

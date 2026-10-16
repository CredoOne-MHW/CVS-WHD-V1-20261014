import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Company, User, Plan, Lead, WaLog, AiAgent, AiAllocation, AiUsage, AiProvider, Connector, PlatformSetting } from "../../models";
import { cached, invalidate } from "../../lib/cache";
import { can, requireScope, invalidateAuth } from "../../middleware/auth";
import { h, parse, notFound, badRequest, paging, escapeRegex, HttpError } from "../../lib/http";
import { encrypt } from "../../lib/crypto";
import multer from "multer";
import { ctxUpload } from "../../lib/context";
import { nextRenewal, FREQ_KEYS } from "../../../shared/billing";
import { renewAllocations } from "../../lib/billing";
import { dbNameFromCode, validateDbName, provisionDb, inCompanyDb, forEachCompanyDb, migrateAll, dbOf } from "../../lib/tenantdb";
import subscriptionRoutes from "./subscriptions";
import { putObject, deleteObject, folderFor, companyFolder, relayoutCompany, relayoutAll } from "../../lib/s3";
import { baseDomain, baseSource, configuredBases, tenantUrls, clearTenantCache, publicBranding, platformBranding, loadPlatformBranding, setPlatformBranding } from "../../lib/tenant";
import { vercelSync, vercelVerify, vercelRemove, vercelConfigured, splitDomain, recordsFor, checkRecords, platformRecords, newVerifyToken, cnameTargetFor, VERIFY_LABEL, FALLBACK_A, FALLBACK_CNAME } from "../../lib/domains";
import { fireEvent } from "../../lib/whatsapp";
import { webhookRoutes, waLogRoutes, activityRoutes, roleRoutes } from "../shared";
import { reportRoutes } from "../reports";
import { COMPANY_MODULES, PLAN_TIERS, ACTIONS, type PermMap, LOGIN_TEMPLATE_KEYS } from "../../../shared/constants";

const r = Router();
r.use(requireScope("super"));

/* ───────────── Dashboard ───────────── */
/** Platform dashboard. Company data lives in one database per company, so per-company figures are gathered
 *  in parallel (bounded) and the whole result is cached for 2 minutes. */
r.get("/dashboard", can("dashboard", "read"), h(async (_req, res) => {
  res.json(
    await cached("sa:dashboard", 120, async () => {
      const since = new Date(Date.now() - 30 * 86400_000);
      const [byPlan, byStatus, recent, waMain] = await Promise.all([
        Company.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$plan", n: { $sum: 1 } } }]),
        Company.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
        Company.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(6).select("name code plan status createdAt").lean(),
        WaLog.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$result", n: { $sum: 1 } } }]),
      ]);
      const per = await forEachCompanyDb(async (co) => {
        const m = { companyId: co._id, createdAt: { $gte: since } };
        const [leads30, total, won, trend, wa, ai] = await Promise.all([
          Lead.countDocuments({ ...m, deletedAt: null }),
          Lead.countDocuments({ companyId: co._id, deletedAt: null }),
          Lead.countDocuments({ ...m, deletedAt: null, status: "Converted / Service Initiated" }),
          Lead.aggregate([{ $match: { ...m, deletedAt: null } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, n: { $sum: 1 } } }]).catch(() => []),
          WaLog.aggregate([{ $match: m }, { $group: { _id: "$result", n: { $sum: 1 } } }]).catch(() => []),
          AiUsage.aggregate([{ $match: m }, { $group: { _id: null, credits: { $sum: "$credits" }, cost: { $sum: "$cost" }, billed: { $sum: "$billed" } } }]).catch(() => []),
        ]);
        return { leads30, total, won, trend, wa, ai: ai[0] };
      });
      const sumBy = (rows: any[]) => Object.entries(rows.reduce((a: any, r: any) => ((a[r._id] = (a[r._id] || 0) + r.n), a), {})).map(([_id, n]) => ({ _id, n }));
      const trend = sumBy(per.flatMap((p) => p.value.trend)).sort((a: any, b: any) => (a._id < b._id ? -1 : 1));
      const ai = per.reduce((a, p) => ({ credits: a.credits + (p.value.ai?.credits || 0), cost: a.cost + (p.value.ai?.cost || 0), billed: a.billed + (p.value.ai?.billed || 0) }), { credits: 0, cost: 0, billed: 0 });
      const topCompanies = per
        .map((p) => ({ _id: p.company._id, name: p.company.name, leads: p.value.leads30, won: p.value.won }))
        .filter((x) => x.leads)
        .sort((a, b) => b.leads - a.leads)
        .slice(0, 5);
      return {
        byPlan,
        byStatus,
        leads30: per.reduce((a, p) => a + p.value.leads30, 0),
        totalLeads: per.reduce((a, p) => a + p.value.total, 0),
        wa: sumBy([...waMain, ...per.flatMap((p) => p.value.wa)]),
        ai,
        recent,
        trend,
        topCompanies,
      };
    })
  );
}));

/** Move companies created before per-company databases into their own database (also happens automatically on first use). */
r.post("/companies/migrate-databases", can("companies", "update"), h(async (_req, res) => {
  res.locals.action = "Move to company databases";
  res.json({ results: await migrateAll() });
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
  slug: z.string().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, "Short name: 2–32 lowercase letters, numbers or hyphens").optional(),
  customDomain: z
    .string()
    .toLowerCase()
    .transform((s) => s.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .refine((s) => s === "" || /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s), "Enter a domain like leads.yourcompany.com")
    .optional(),
  branding: z
    .object({
      shortName: z.string().max(40).optional(),
      tagline: z.string().max(120).optional(),
      headline: z.string().max(140).optional(),
      subheadline: z.string().max(400).optional(),
      footerText: z.string().max(160).optional(),
      themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Theme color must be a hex like #2f5c24").optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      loginLayout: z.enum(["split", "banner", "centered"]).optional(),
      loginTemplate: z.enum(LOGIN_TEMPLATE_KEYS).optional(),
      supportEmail: z.string().email().optional().or(z.literal("")),
      supportPhone: z.string().max(20).optional(),
    })
    .optional(),
});

const RESERVED_SLUGS = new Set(["www", "app", "api", "admin", "sa", "login", "mail", "smtp", "static", "cdn", "assets", "docs", "help", "support", "status", "dev", "staging", "test"]);

async function assertDomainFree(id: string | undefined, slug?: string, customDomain?: string) {
  if (slug) {
    if (RESERVED_SLUGS.has(slug)) throw badRequest(`"${slug}" is reserved. Pick another short name.`);
    if (await Company.exists({ slug, _id: { $ne: id }, deletedAt: null })) throw badRequest(`Short name "${slug}" is already taken`);
  }
  if (customDomain) {
    const base = baseDomain();
    if (customDomain.endsWith(".vercel.app") || (base && (customDomain === base || customDomain.endsWith(`.${base}`)))) throw badRequest("Use the company's own domain here — the platform sub-domain is created automatically from the short name");
    if (await Company.exists({ customDomain, _id: { $ne: id }, deletedAt: null })) throw badRequest("That domain is already mapped to another company");
  }
}

/** Register the custom domain on Vercel (when the API is configured) and store challenges + recommendations. */
async function syncDomain(companyId: any, domain?: string | null) {
  if (!domain) return;
  try {
    const v = await vercelSync(domain);
    const set: any = { "domain.lastCheckedAt": new Date() };
    if (v && "error" in v) set["domain.lastError"] = v.error;
    else if (v) Object.assign(set, { "domain.vercelAdded": true, "domain.verified": v.verified, "domain.configured": v.configured, "domain.verification": v.verification, "domain.recommendedIPv4": v.recommendedIPv4, "domain.recommendedCNAME": v.recommendedCNAME, "domain.lastError": null });
    await Company.updateOne({ _id: companyId }, { $set: set });
  } catch (e: any) {
    await Company.updateOne({ _id: companyId }, { $set: { "domain.lastError": e?.message } });
  }
}

/** support.<address> for every address the company has (platform sub-domain and own domain). */
function supportHosts(c: any) {
  const base = baseDomain();
  return [c.slug && base ? `support.${c.slug}.${base}` : null, c.customDomain ? `support.${c.customDomain}` : null].filter(Boolean) as string[];
}
/** Registers the support portal addresses on Vercel (best effort — the DNS record is still needed). */
async function syncSupport(c: any, old?: any) {
  if (!vercelConfigured()) return;
  for (const d of old ? supportHosts(old).filter((x) => !supportHosts(c).includes(x)) : []) await vercelRemove(d).catch(() => undefined);
  for (const d of supportHosts(c)) await vercelSync(d).catch(() => undefined);
}

/** S3 base folder = the company name as typed ("WELLNESSHIVE DIAGNOSTICA LLP"), unique across companies. */
async function uniqueFolder(name: string) {
  const base = companyFolder(name);
  let folder = base;
  for (let i = 2; await Company.exists({ s3Folder: folder }); i++) folder = `${base}-${i}`;
  return folder;
}

const slugFrom = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

r.get("/companies", can("companies", "read"), h(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const q: any = { deletedAt: null };
  if (req.query.q) q.$or = ["name", "code", "email", "contactPerson"].map((f) => ({ [f]: { $regex: escapeRegex(String(req.query.q)), $options: "i" } }));
  if (req.query.plan) q.plan = req.query.plan;
  if (req.query.status) q.status = req.query.status;
  const [items, total] = await Promise.all([Company.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Company.countDocuments(q)]);
  const owners = await User.find({ companyId: { $in: items.map((c: any) => c._id) }, isOwner: true }).select("companyId email").lean();
  const loginBy = Object.fromEntries(owners.map((o: any) => [String(o.companyId), o.email]));
  res.json({ items: items.map((c: any) => ({ ...c, ...tenantUrls(c), loginEmail: loginBy[String(c._id)] })), total, page, limit });
}));

r.get("/companies/:id", can("companies", "read"), h(async (req, res) => {
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null }).lean<any>();
  if (!c) throw notFound();
  const [owner, allocations, leadCount, connectors] = await Promise.all([
    User.findOne({ companyId: c._id, isOwner: true }).select("email name").lean<any>(),
    AiAllocation.find({ companyId: c._id }).lean(),
    inCompanyDb(c._id, () => Lead.countDocuments({ companyId: c._id, deletedAt: null })),
    inCompanyDb(c._id, () => Connector.countDocuments({ companyId: c._id })),
  ]);
  res.json({ ...c, ...tenantUrls(c), brandingPublic: publicBranding(c), loginEmail: owner?.email, allocations, leadCount, connectors });
}));

r.post("/companies", can("companies", "create"), h(async (req, res) => {
  const b = parse(companyBody.required({ password: true }), req.body);
  const loginEmail = (b.loginEmail || b.email).toLowerCase();
  const slug = b.slug || slugFrom(b.code || b.name);
  const customDomain = b.customDomain || undefined;
  if (!(await Plan.exists({ name: b.plan }))) throw badRequest("Unknown plan");
  if (await User.exists({ email: loginEmail })) throw badRequest("Login email is already used by another account");
  await assertDomainFree(undefined, slug, customDomain);
  // The company code becomes the company's own database; it must be valid and never reused (not even from a deleted company)
  const dbName = dbNameFromCode(b.code.toUpperCase());
  const bad = validateDbName(dbName);
  if (bad) throw badRequest(bad);
  if (await Company.exists({ $or: [{ code: dbName }, { dbName }] })) throw badRequest(`Company code ${dbName} is already used (or was used by a deleted company) — its database exists. Pick another code.`);
  try {
    await provisionDb(dbName);
  } catch (e: any) {
    throw new HttpError(500, `Could not create database "${dbName}": ${e?.message}. On MongoDB Atlas the database user needs "readWriteAnyDatabase", and free/shared clusters cap the number of databases.`);
  }
  const company = await Company.create({
    ...b,
    code: b.code.toUpperCase(),
    dbName,
    dbReadyAt: new Date(),
    slug,
    customDomain,
    s3Folder: await uniqueFolder(b.name),
    domain: customDomain ? { verifyToken: newVerifyToken() } : undefined,
    branding: { shortName: b.name, ...(b.branding || {}), updatedAt: new Date() },
    loginEmail: undefined,
    password: undefined,
    trialEndsAt: b.plan === "Trial" ? new Date(Date.now() + 14 * 86400_000) : undefined,
  });
  try {
    await User.create({ scope: "company", companyId: company._id, name: b.contactPerson || b.name, email: loginEmail, phone: b.whatsapp || b.phone, passwordHash: await bcrypt.hash(b.password, 12), isOwner: true });
  } catch (e) {
    await Company.deleteOne({ _id: company._id });
    throw e;
  }
  await syncDomain(company._id, customDomain);
  await syncSupport(company);
  clearTenantCache();
  res.locals.item = company.name;
  const urls = tenantUrls(company);
  if (b.whatsapp) fireEvent("super", undefined, "company_created", { phone: b.whatsapp, name: b.contactPerson, company: b.name, message: `Welcome, ${b.contactPerson || b.name}! Your ${b.plan} workspace is ready.\nLogin: ${urls.customUrl || urls.platformUrl || ""}\nUser: ${loginEmail}` }).catch(() => undefined);
  res.status(201).json({ ...company.toObject(), ...urls });
}));

r.put("/companies/:id", can("companies", "update"), h(async (req, res) => {
  const b = parse(companyBody.partial(), req.body);
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null });
  if (!c) throw notFound();
  const { loginEmail, password, branding, ...rest } = b;
  const oldDomain = c.customDomain;
  const before = { slug: c.slug, customDomain: c.customDomain };
  const newDomain = rest.customDomain === undefined ? oldDomain : rest.customDomain || undefined;
  await assertDomainFree(String(c._id), rest.slug, newDomain || undefined);
  // the database name is fixed at creation; changing the code later only renames the label
  c.set({ ...rest, customDomain: newDomain, code: rest.code ? rest.code.toUpperCase() : c.code });
  if (branding) c.set("branding", { ...(c.toObject().branding || {}), ...branding, updatedAt: new Date() });
  if (newDomain !== oldDomain) c.set("domain", newDomain ? { verifyToken: newVerifyToken() } : {});
  await c.save();
  if (newDomain !== oldDomain) {
    if (oldDomain) await vercelRemove(oldDomain);
    await syncDomain(c._id, newDomain);
  }
  if (newDomain !== before.customDomain || c.slug !== before.slug) await syncSupport(c, before);
  clearTenantCache();
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
  await invalidateAuth();
  res.locals.item = c.name;
  res.json(c);
}));

r.post("/companies/:id/status", can("companies", "update"), h(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["active", "inactive"]) }), req.body);
  const c = await Company.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, { status }, { new: true });
  if (!c) throw notFound();
  if (status === "inactive") await User.updateMany({ companyId: c._id }, { $inc: { tokenVersion: 1 } }); // kick sessions
  await invalidateAuth();
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
  const c = await Company.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, { deletedAt: new Date(), status: "inactive", code: `DEL-${Date.now()}`, $unset: { slug: 1, customDomain: 1 } });
  if (!c) throw notFound();
  if (c.customDomain) await vercelRemove(c.customDomain);
  clearTenantCache();
  await invalidateAuth();
  await User.updateMany({ companyId: c._id }, { active: false, $inc: { tokenVersion: 1 }, $set: { email: undefined } }).catch(() => undefined);
  await User.deleteMany({ companyId: c._id }); // frees login emails; data stays (soft-deleted company) for audit
  res.locals.item = c.name;
  res.json({ ok: true });
}));

/** AI credit allocation for a company (Company → AI Agents). */
r.put("/companies/:id/ai", can("companies", "update"), h(async (req, res) => {
  const b = parse(z.array(z.object({ agentId: z.string(), credits: z.coerce.number().min(0) })), req.body);
  const co = await Company.findById(req.params.id).select("dbName code").lean<any>();
  if (!co) throw notFound();
  const dbName = co.dbName || dbNameFromCode(co.code);
  for (const a of b) {
    const now = new Date();
    await AiAllocation.updateOne(
      { companyId: req.params.id, agentId: a.agentId },
      { $set: { credits: a.credits, allocated: true, dbName }, $setOnInsert: { used: 0, startDate: now, frequency: "monthly", renewalDate: nextRenewal(now, "monthly", now), allocatedBy: req.auth!.email } },
      { upsert: true }
    );
    // topped up → re-arm the one-time "credits exhausted" WhatsApp alert
    await AiAllocation.updateOne({ companyId: req.params.id, agentId: a.agentId, $expr: { $gt: ["$credits", "$used"] } }, { $set: { exhaustedNotifiedAt: null } });
  }
  res.locals.module = "companies";
  res.locals.item = `AI allocation ${req.params.id}`;
  res.json(await AiAllocation.find({ companyId: req.params.id }).lean());
}));

/* ───────────── AI Agents (platform models) ───────────── */
const agentBody = z.object({
  name: z.string().min(2).max(80),
  llmVersion: z.string().min(2).max(80),
  provider: z.string().min(2).max(40),
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
  const usage = await AiAllocation.aggregate([{ $match: { allocated: { $ne: false } } }, { $group: { _id: "$agentId", allocated: { $sum: "$credits" }, used: { $sum: "$used" }, companies: { $sum: 1 } } }]);
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

/* ───────────── AI Agents › Allocation (which company gets which model, with renewal cycle) ───────────── */
const allocBody = z.object({
  companyIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1).max(500),
  agentIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1).max(50),
  startDate: z.coerce.date(),
  frequency: z.enum(FREQ_KEYS),
  credits: z.coerce.number().min(0).max(100_000_000).optional(), // per cycle; default = the model's credits
  dbNames: z.record(z.string()).optional(), // companyId → database shown in the pop-up (must be the company's own)
});

r.get("/ai-allocations", can("ai_agents", "read"), h(async (req, res) => {
  await renewAllocations();
  const q: any = { allocated: { $ne: false } };
  if (typeof req.query.companyId === "string" && /^[a-f0-9]{24}$/.test(req.query.companyId)) q.companyId = req.query.companyId;
  if (typeof req.query.agentId === "string" && /^[a-f0-9]{24}$/.test(req.query.agentId)) q.agentId = req.query.agentId;
  const { page, limit, skip } = paging(req.query);
  const [items, total] = await Promise.all([AiAllocation.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<any[]>(), AiAllocation.countDocuments(q)]);
  const [cos, ags] = await Promise.all([
    Company.find({ _id: { $in: items.map((x) => x.companyId) } }).select("name code dbName").lean<any[]>(),
    AiAgent.find({ _id: { $in: items.map((x) => x.agentId) } }).select("name llmVersion companyRate active").lean<any[]>(),
  ]);
  const byId = (arr: any[], id: any) => arr.find((x) => String(x._id) === String(id));
  res.json({
    items: items.map((a) => ({ ...a, dbName: a.dbName || byId(cos, a.companyId)?.dbName || byId(cos, a.companyId)?.code, company: byId(cos, a.companyId), model: byId(ags, a.agentId), remaining: +((a.credits || 0) - (a.used || 0)).toFixed(3) })),
    page,
    limit,
    total,
  });
}));

r.post("/ai-allocations", can("ai_agents", "create"), h(async (req, res) => {
  const b = parse(allocBody, req.body);
  const [cos, ags] = await Promise.all([
    Company.find({ _id: { $in: b.companyIds }, deletedAt: null }).select("_id dbName dbReadyAt code").lean<any[]>(),
    AiAgent.find({ _id: { $in: b.agentIds }, active: true }).select("_id credits").lean<any[]>(),
  ]);
  if (!cos.length || !ags.length) throw badRequest("Pick at least one active company and one active model");
  // each company's AI reads only that company's own database
  const dbFor = new Map(cos.map((c) => [String(c._id), c.dbName || dbNameFromCode(c.code)]));
  if (b.dbNames) for (const [cid, db] of Object.entries(b.dbNames)) if (dbFor.has(cid) && dbFor.get(cid) !== db) throw badRequest("An AI model can only read its own company's database");
  const now = new Date();
  const renewalDate = nextRenewal(b.startDate, b.frequency, now);
  const ops = cos.flatMap((c) =>
    ags.map((a) => ({
      updateOne: {
        filter: { companyId: c._id, agentId: a._id },
        update: {
          $set: { allocated: true, startDate: b.startDate, frequency: b.frequency, renewalDate, credits: b.credits ?? (Number(a.credits) || 0), allocatedBy: req.auth!.email, exhaustedNotifiedAt: null, dbName: dbFor.get(String(c._id)) },
          $setOnInsert: { used: 0 },
        },
        upsert: true,
      },
    }))
  );
  await AiAllocation.bulkWrite(ops, { ordered: false });
  await invalidate("billing:");
  res.locals.action = "Allocate AI model";
  res.locals.item = `${ags.length} model(s) → ${cos.length} company(ies)`;
  res.status(201).json({ allocated: ops.length, renewalDate });
}));

r.put("/ai-allocations/:id", can("ai_agents", "update"), h(async (req, res) => {
  const b = parse(z.object({ credits: z.coerce.number().min(0).max(100_000_000).optional(), startDate: z.coerce.date().optional(), frequency: z.enum(FREQ_KEYS).optional(), resetUsed: z.boolean().optional() }), req.body);
  const a = await AiAllocation.findOne({ _id: req.params.id, allocated: { $ne: false } });
  if (!a) throw notFound();
  if (b.credits != null) a.credits = b.credits;
  if (b.startDate) a.startDate = b.startDate;
  if (b.frequency) a.frequency = b.frequency;
  if (b.startDate || b.frequency) a.renewalDate = nextRenewal(a.startDate || new Date(), a.frequency || "monthly");
  if (b.resetUsed) a.used = 0;
  if (a.credits > a.used) a.exhaustedNotifiedAt = null;
  await a.save();
  await invalidate("billing:");
  res.locals.item = `AI allocation ${a._id}`;
  res.json(a);
}));

r.delete("/ai-allocations/:id", can("ai_agents", "delete"), h(async (req, res) => {
  // usage history stays; the model just disappears from the company's AI Agent screen
  const a = await AiAllocation.findOneAndUpdate({ _id: req.params.id }, { $set: { allocated: false } });
  if (!a) throw notFound();
  await invalidate("billing:");
  res.locals.item = `AI allocation ${a._id}`;
  res.json({ ok: true });
}));

/* ───────────── AI providers (add / remove from the dropdown) ───────────── */
r.get("/ai-providers", can("ai_agents", "read"), h(async (_req, res) => {
  const [list, used] = await Promise.all([AiProvider.find().sort({ name: 1 }).lean(), AiAgent.aggregate([{ $group: { _id: "$provider", n: { $sum: 1 } } }])]);
  const u = Object.fromEntries(used.map((x: any) => [x._id, x.n]));
  res.json(list.map((p: any) => ({ ...p, agents: u[p.key] || 0 })));
}));
r.post("/ai-providers", can("ai_agents", "create"), h(async (req, res) => {
  const b = parse(
    z.object({
      name: z.string().min(2).max(60),
      key: z.string().toLowerCase().regex(/^[a-z0-9-]{2,30}$/).optional(),
      apiStyle: z.enum(["openai", "anthropic", "google"]).default("openai"),
      baseUrl: z.string().url(),
      modelsUrl: z.string().url().optional().or(z.literal("")),
      extraHeaders: z.record(z.string()).optional(),
    }),
    req.body
  );
  const key = b.key || b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const doc = await AiProvider.create({ ...b, key, modelsUrl: b.modelsUrl || undefined });
  await invalidate("ai:provider:");
  res.locals.item = doc.name;
  res.status(201).json(doc);
}));
r.delete("/ai-providers/:id", can("ai_agents", "delete"), h(async (req, res) => {
  const p = await AiProvider.findById(req.params.id);
  if (!p) throw notFound();
  const n = await AiAgent.countDocuments({ provider: p.key });
  if (n) throw badRequest(`${n} AI agent(s) use ${p.name}. Change or delete them first.`);
  await p.deleteOne();
  await invalidate("ai:provider:");
  res.locals.item = p.name;
  res.json({ ok: true });
}));
/** Model list for the LLM-version picker (OpenRouter's list is public; others use the key typed in the form). */
r.post("/ai-providers/:id/models", can("ai_agents", "read"), h(async (req, res) => {
  const p = await AiProvider.findById(req.params.id).lean<any>();
  if (!p) throw notFound();
  const url = p.modelsUrl || `${p.baseUrl.replace(/\/$/, "")}/models`;
  const key = typeof req.body?.apiKey === "string" ? req.body.apiKey : "";
  const out = await cached(`ai:models:${p.key}:${key ? "k" : "anon"}`, 3600, async () => {
    const r2 = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}`, "x-api-key": key, "anthropic-version": "2023-06-01" } : {}, signal: AbortSignal.timeout(15000) });
    if (!r2.ok) throw new HttpError(r2.status === 401 ? 400 : 502, r2.status === 401 ? "Enter the API key first to load this provider's models" : `Could not load models (${r2.status})`);
    const j: any = await r2.json();
    return (j.data || j.models || []).slice(0, 1000).map((m: any) => ({
      id: m.id || m.name?.replace(/^models\//, ""),
      name: m.name || m.display_name || m.id,
      context: m.context_length || m.inputTokenLimit,
      // OpenRouter pricing is USD per token → shown per 1M tokens
      priceIn: m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : undefined,
      priceOut: m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : undefined,
    }));
  });
  res.json(out);
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
  await invalidateAuth();
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

/* ───────────── Branding assets (logo / side banner / favicon) ───────────── */
const imgUpload = ctxUpload(multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } }));
r.post("/companies/:id/brand-asset/:kind", can("companies", "update"), imgUpload.single("file"), h(async (req, res) => {
  const kind = req.params.kind;
  if (!["logo", "banner", "favicon"].includes(kind)) throw badRequest("kind must be logo, banner or favicon");
  if (!req.file) throw badRequest("Attach an image");
  if (!/^image\/(png|jpe?g|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(req.file.mimetype)) throw badRequest("Use PNG, JPG, WebP, SVG or ICO");
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null });
  if (!c) throw notFound();
  const old = c.branding?.[`${kind}Key`];
  const folder = await folderFor(c);
  const sub = kind === "banner" ? "banner" : "logo"; // favicon lives with the logo
  const { key } = await putObject(`${folder}/${sub}`, `${kind}-${req.file.originalname}`, req.file.buffer, req.file.mimetype);
  c.set(`branding.${kind}Key`, key);
  c.set("branding.updatedAt", new Date());
  await c.save();
  if (old) deleteObject(old);
  await relayoutCompany(c._id).catch(() => undefined); // bring any older files into <Company Name>/logo|banner|brain
  clearTenantCache();
  res.locals.action = `Upload ${kind}`;
  res.locals.item = c.name;
  res.json({ ok: true, branding: publicBranding(c.toObject()) });
}));
/** Re-organise S3 files into <Company Name>/logo · /banner · /brain (one company, or all with id "all"). */
r.post("/companies/:id/s3-relayout", can("companies", "update"), h(async (req, res) => {
  const out = req.params.id === "all" ? await relayoutAll() : await relayoutCompany(req.params.id);
  clearTenantCache();
  res.locals.action = "Re-organise S3 folders";
  res.json(out);
}));
r.delete("/companies/:id/brand-asset/:kind", can("companies", "update"), h(async (req, res) => {
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null });
  if (!c) throw notFound();
  const old = c.branding?.[`${req.params.kind}Key`];
  c.set(`branding.${req.params.kind}Key`, undefined);
  c.set("branding.updatedAt", new Date());
  await c.save();
  if (old) deleteObject(old);
  clearTenantCache();
  res.json({ ok: true });
}));

/* ───────────── Platform branding (Super Admin login page) ───────────── */
const platformBrandingBody = z.object({
  loginTemplate: z.enum(LOGIN_TEMPLATE_KEYS),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Theme color must be a hex like #2b2d72"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Accent color must be a hex like #6c63ff"),
  tagline: z.string().trim().max(80).optional().or(z.literal("")),
  headline: z.string().trim().max(140).optional().or(z.literal("")),
  subheadline: z.string().trim().max(400).optional().or(z.literal("")),
  footerText: z.string().trim().max(160).optional().or(z.literal("")),
});
r.get("/platform-branding", can("branding", "read"), h(async (_req, res) => {
  await loadPlatformBranding(true);
  res.json(platformBranding());
}));
r.put("/platform-branding", can("branding", "update"), h(async (req, res) => {
  const b = parse(platformBrandingBody, req.body);
  await PlatformSetting.updateOne({ _id: "platform_branding" }, { $set: { value: b } }, { upsert: true });
  setPlatformBranding(b);
  res.locals.item = `Platform login · ${b.loginTemplate}`;
  res.json(platformBranding());
}));

/* ───────────── Domain & DNS for one company ───────────── */
async function domainReport(c: any, live: boolean) {
  if (c.customDomain && !c.domain?.verifyToken) {
    const verifyToken = newVerifyToken(); // companies created before tokens existed
    await Company.updateOne({ _id: c._id }, { $set: { "domain.verifyToken": verifyToken } });
    c = { ...c, domain: { ...(c.domain || {}), verifyToken } };
  }
  const { zone, records } = recordsFor(c);
  const checked = live ? await checkRecords(records) : records;
  const required = checked.filter((x) => x.required);
  const txt = checked.find((x) => x.host.startsWith(VERIFY_LABEL));
  if (live && txt) await Company.updateOne({ _id: c._id }, { $set: { "domain.ownershipVerified": txt.status === "ok", "domain.lastCheckedAt": new Date() } });
  return {
    company: { _id: c._id, name: c.name, slug: c.slug, customDomain: c.customDomain },
    ...tenantUrls(c),
    baseDomain: baseDomain(),
    cnameTarget: cnameTargetFor(c),
    zone,
    records: checked,
    ownershipVerified: live && txt ? txt.status === "ok" : !!c.domain?.ownershipVerified,
    vercel: { configured: vercelConfigured(), added: !!c.domain?.vercelAdded, verified: c.domain?.verified, configuredDns: c.domain?.configured, lastError: c.domain?.lastError, lastCheckedAt: c.domain?.lastCheckedAt },
    ready: !!c.customDomain && required.length > 0 && required.every((x) => x.status === "ok") && (vercelConfigured() ? c.domain?.verified !== false : true),
    support: await supportReport(c, live),
  };
}

/** Client support portal addresses: one CNAME each (support.<address> → Vercel), plus the always-working /support path. */
async function supportReport(c: any, live: boolean) {
  const urls = tenantUrls(c);
  const records = supportHosts(c).map((fqdn) => {
    const parentIsCustom = !!c.customDomain && fqdn === `support.${c.customDomain}`;
    const zone = parentIsCustom ? splitDomain(c.customDomain).zone : splitDomain(baseDomain()).zone;
    const host = zone && fqdn.endsWith(`.${zone}`) ? fqdn.slice(0, -(zone.length + 1)) : fqdn;
    return { type: "CNAME" as const, host, fqdn, value: FALLBACK_CNAME, ttl: "Auto / 3600", purpose: parentIsCustom ? "Client support portal on the company's own domain" : "Client support portal on the platform address", required: false, zone };
  });
  const checked = live ? await checkRecords(records as any) : records;
  return {
    urls: supportHosts(c).map((h) => `https://${h}`),
    fallbackUrl: urls.customUrl ? `${urls.customUrl}/support` : urls.platformUrl ? `${urls.platformUrl}/support` : undefined,
    records: checked,
  };
}

r.get("/companies/:id/domain", can("companies", "read"), h(async (req, res) => {
  const c = await Company.findOne({ _id: req.params.id, deletedAt: null }).lean<any>();
  if (!c) throw notFound();
  res.json(await domainReport(c, false));
}));

/** Re-sync with Vercel, ask Vercel to verify, and look up every record live. */
r.post("/companies/:id/domain/check", can("companies", "update"), h(async (req, res) => {
  let c = await Company.findOne({ _id: req.params.id, deletedAt: null }).lean<any>();
  if (!c) throw notFound();
  if (c.customDomain && vercelConfigured()) {
    await syncDomain(c._id, c.customDomain);
    await syncSupport(c);
    const v = await vercelVerify(c.customDomain);
    if (v?.ok) await Company.updateOne({ _id: c._id }, { $set: { "domain.verified": v.verified } });
    c = await Company.findById(c._id).lean<any>();
  }
  res.locals.action = "DNS check";
  res.locals.item = c.customDomain || c.slug;
  res.json(await domainReport(c, true));
}));

/* ───────────── Knowledgebase ───────────── */
r.get("/knowledgebase/config", can("knowledgebase", "read"), h(async (req, res) => {
  const example = { slug: "wellnesshive", customDomain: "leads.wellnesshive.in", domain: { verifyToken: "credoone-verify=7f3c2a91d4e85b60c1a9e2f4b8d73c05" } };
  res.json({
    baseDomain: baseDomain(),
    baseSource: baseSource(),
    configuredBaseDomains: configuredBases(),
    vercelEnv: process.env.VERCEL_ENV || "local",
    deploymentHost: process.env.VERCEL_URL || req.headers.host,
    vercelConfigured: vercelConfigured(),
    fallbackA: FALLBACK_A,
    fallbackCNAME: FALLBACK_CNAME,
    platform: platformRecords(),
    branding: platformBranding(),
    example: { ...recordsFor(example), cnameTarget: cnameTargetFor(example) },
  });
}));

/** One-click: add <base> and *.<base> to the Vercel project. */
r.post("/knowledgebase/platform-domains", can("knowledgebase", "update"), h(async (_req, res) => {
  const base = baseDomain();
  if (!base) throw badRequest("Set APP_BASE_DOMAIN first");
  if (!vercelConfigured()) throw badRequest("Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID to automate this, or add the domains in Vercel → Settings → Domains");
  const out = [];
  for (const d of [base, `*.${base}`]) out.push({ domain: d, result: await vercelSync(d) });
  res.locals.action = "Add platform domains";
  res.json(out);
}));

r.get("/knowledgebase/domains", can("knowledgebase", "read"), h(async (req, res) => {
  const list = await Company.find({ deletedAt: null }).select("name code slug customDomain domain status branding.themeColor").sort({ name: 1 }).lean<any[]>();
  const live = req.query.live === "1";
  const rows = await Promise.all(
    list.map(async (c) => {
      const rep = live && c.customDomain ? await domainReport(c, true) : null;
      return { _id: c._id, name: c.name, code: c.code, status: c.status, themeColor: c.branding?.themeColor, ...tenantUrls(c), customDomain: c.customDomain, verified: c.domain?.verified, configured: c.domain?.configured, ready: rep?.ready, lastError: c.domain?.lastError };
    })
  );
  res.json(rows);
}));

r.use("/subscriptions", subscriptionRoutes);
r.use("/reports", reportRoutes("super"));
r.use("/roles", roleRoutes("super"));
r.use("/activity-logs", activityRoutes("super"));
r.use("/webhooks", webhookRoutes("super"));
r.use("/wa-logs", waLogRoutes("super"));

export default r;

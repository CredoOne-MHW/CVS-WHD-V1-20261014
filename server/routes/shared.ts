import { Router, type Request } from "express";
import { runInMain, setTenantDb } from "../lib/context";
import { dbOf, forEachCompanyDb } from "../lib/tenantdb";
import { z } from "zod";
import { Webhook, WaLog, ActivityLog, EventType, Role, Company, Plan } from "../models";
import { can, invalidateAuth, permOf, companyCaps } from "../middleware/auth";
import { h, parse, notFound, badRequest, forbidden, paging, dateRange, escapeRegex } from "../lib/http";
import { encrypt, decrypt } from "../lib/crypto";
import { buildPayloads, dispatch, resendLog } from "../lib/whatsapp";
import { ACTIONS, COMPANY_MODULES, DEFAULT_PAYLOAD_TEMPLATE, normalizePhone, type PermMap } from "../../shared/constants";
import { eventsFor, isSystemEvent } from "../../shared/events";

type Scope = "super" | "company";
const scopeFilter = (req: Request, scope: Scope) => (scope === "company" ? { scope, companyId: req.auth!.companyId } : { scope });

/* ───────────── WhatsApp Webhooks (cards + Add Webhook modal) ───────────── */

const webhookBody = z.object({
  name: z.string().min(1).max(120),
  event: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  url: z.string().url(),
  method: z.enum(["POST", "PUT", "PATCH", "GET"]).default("POST"),
  active: z.boolean().default(true),
  headers: z.string().optional(), // JSON text
  payloadTemplate: z.string().min(2),
  templateName: z.string().max(120).optional(),
  singleLine: z.boolean().default(true),
  lineSeparator: z.string().max(20).optional(),
  maxChars: z.coerce.number().int().min(100).max(4096).default(800),
  // additional WhatsApp numbers that receive the same message (10 digits each, max 10)
  extraNumbers: z
    .array(z.string())
    .max(10, "Up to 10 additional numbers")
    .transform((a) => [...new Set(a.map((x) => normalizePhone(x)).filter(Boolean))])
    .refine((a) => a.every((x) => /^[6-9]\d{9}$/.test(x)), "Each additional number must be a valid 10-digit mobile number")
    .optional(),
  schedule: z
    .object({ freq: z.enum(["off", "daily", "weekly"]), hour: z.coerce.number().int().min(0).max(23).default(9), weekday: z.coerce.number().int().min(0).max(6).default(1), days: z.coerce.number().refine((d) => [1, 7, 30].includes(d)).default(7) })
    .optional(),
});

function validateJsonText(label: string, text?: string, allowPlaceholders = false) {
  if (!text?.trim()) return;
  const probe = allowPlaceholders ? text.replace(/\{\{\s*[\w.]+\s*\}\}/g, "0") : text;
  try {
    JSON.parse(probe);
  } catch {
    throw badRequest(`${label} must be valid JSON`);
  }
}

const serializeHook = (w: any) => ({ ...w, headers: decrypt(w.headersEnc) || "", headersEnc: undefined });

export function webhookRoutes(scope: Scope) {
  const r = Router();
  const mod = "wa_webhooks:webhooks"; // falls back to "wa_webhooks" where sub-modules don't exist (Super Admin)

  /** Every event this deployment can send (shared/events.ts) — so the dropdown always matches the running code. */
  r.get("/events", can(mod, "read"), h(async (req, res) => {
    const a = req.auth!;
    // company: only events of modules in the company's plan
    const sys = eventsFor(scope)
      .filter((e) => scope === "super" || !e.module || a.perms[e.module]?.read || a.isOwner)
      .map(({ key, label, group, to, description, params, manual }) => ({ key, label, group, to, description, params, manual: !!manual, system: true }));
    if (scope === "super") return res.json(sys);
    const custom = await EventType.find({ companyId: a.companyId }).sort({ label: 1 }).lean();
    res.json([...sys, ...custom.map((e: any) => ({ _id: e._id, key: e.key, label: e.label, group: "Custom", to: "", description: "Your own event type — used with Post / broadcast.", params: [], system: false }))]);
  }));

  if (scope === "company") {
    r.post("/events", can(mod, "create"), h(async (req, res) => {
      const b = parse(z.object({ label: z.string().min(2).max(80), key: z.string().regex(/^[a-z0-9_]+$/).max(60).optional() }), req.body);
      const key = b.key || b.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (isSystemEvent("company", key)) throw badRequest("That key is reserved by a system event");
      res.status(201).json(await EventType.create({ companyId: req.auth!.companyId, key, label: b.label }));
    }));
    r.delete("/events/:id", can(mod, "delete"), h(async (req, res) => {
      await EventType.deleteOne({ _id: req.params.id, companyId: req.auth!.companyId });
      res.json({ ok: true });
    }));
  }

  // WhatsApp › Post picks a webhook to send through, so Post access may list them too.
  r.get("/", can("wa_webhooks", "read"), h(async (req, res) => {
    if (!permOf(req.auth?.perms, mod)?.read && !permOf(req.auth?.perms, "wa_webhooks:post")?.create) throw forbidden("No read access to wa_webhooks › webhooks");
    const list = await Webhook.find(scopeFilter(req, scope)).sort({ event: 1, createdAt: 1 }).lean();
    res.json({ items: list.map(serializeHook), defaultTemplate: DEFAULT_PAYLOAD_TEMPLATE });
  }));

  r.post("/", can(mod, "create"), h(async (req, res) => {
    const b = parse(webhookBody, req.body);
    validateJsonText("Headers", b.headers);
    validateJsonText("Payload template", b.payloadTemplate, true);
    const doc = await Webhook.create({ ...b, headers: undefined, headersEnc: encrypt(b.headers), scope, companyId: scope === "company" ? req.auth!.companyId : undefined });
    res.locals.item = doc.name;
    res.status(201).json(serializeHook(doc.toObject()));
  }));

  r.put("/:id", can(mod, "update"), h(async (req, res) => {
    const b = parse(webhookBody.partial(), req.body);
    validateJsonText("Headers", b.headers);
    validateJsonText("Payload template", b.payloadTemplate, true);
    const set: any = { ...b };
    if ("headers" in b) set.headersEnc = encrypt(b.headers) ?? null;
    delete set.headers;
    const doc = await Webhook.findOneAndUpdate({ _id: req.params.id, ...scopeFilter(req, scope) }, { $set: set }, { new: true }).lean();
    if (!doc) throw notFound();
    res.locals.item = (doc as any).name;
    res.json(serializeHook(doc));
  }));

  r.delete("/:id", can(mod, "delete"), h(async (req, res) => {
    const d = await Webhook.findOneAndDelete({ _id: req.params.id, ...scopeFilter(req, scope) });
    if (!d) throw notFound();
    res.locals.item = d.name;
    res.json({ ok: true });
  }));

  /** Preview: render without sending (drives "Sample WhatsApp message" + "Preview of the payload"). */
  r.post("/preview", can(mod, "read"), h(async (req, res) => {
    const { hook, message, phone, name } = req.body || {};
    try {
      const payloads = buildPayloads({ ...hook, event: hook?.event || "sample" }, { phone: phone || "9876543210", name: name || "Riya Sen", company: req.auth!.companyName || "Your Company", message: message || "" });
      res.json({ payloads: payloads.map((p) => ({ part: p.part, body: p.body, chars: p.text.length })) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }));

  r.post("/:id/test", can(mod, "update"), h(async (req, res) => {
    const { phone, message } = parse(z.object({ phone: z.string().regex(/^\d{10}$/, "10-digit number"), message: z.string().optional() }), req.body);
    const hook = await Webhook.findOne({ _id: req.params.id, ...scopeFilter(req, scope) }).lean<any>();
    if (!hook) throw notFound();
    res.locals.action = "Send test";
    res.locals.item = hook.name;
    const results = await dispatch(hook, { phone, name: req.auth!.name, company: req.auth!.companyName, message: message || `Test message from ${hook.name} (${hook.event}).` }, { scope, companyId: req.auth!.companyId, trigger: "test", triggeredBy: req.auth!.email });
    res.json({ results });
  }));

  return r;
}

/* ───────────── WhatsApp Logs ───────────── */

export function waLogRoutes(scope: Scope) {
  const r = Router();
  r.get("/", can("wa_logs", "read"), h(async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const q: any = { ...scopeFilter(req, scope), ...dateRange(req.query) };
    if (scope === "super" && req.query.companyId) {
      if (!/^[a-f0-9]{24}$/.test(String(req.query.companyId))) throw notFound();
      Object.assign(q, { scope: "company", companyId: req.query.companyId });
      setTenantDb(await dbOf(req.query.companyId)); // that company's logs live in its own database
    }
    if (req.query.event) q.event = req.query.event;
    if (req.query.phone) q.to = { $regex: escapeRegex(String(req.query.phone).replace(/\D/g, "")) }; // "To" filter (`to` is the date range end)
    if (req.query.result) q.result = req.query.result;
    const [items, total] = await Promise.all([WaLog.find(q).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).select("-response").lean(), WaLog.countDocuments(q)]);
    res.json({ items, total, page, limit });
  }));
  r.get("/:id", can("wa_logs", "read"), h(async (req, res) => {
    if (scope === "super" && /^[a-f0-9]{24}$/.test(String(req.query.companyId || ""))) setTenantDb(await dbOf(req.query.companyId));
    const log = await WaLog.findOne({ _id: req.params.id, ...(scope === "company" ? { companyId: req.auth!.companyId } : {}) }).lean();
    if (!log) throw notFound();
    res.json(log);
  }));
  r.post("/:id/resend", can("wa_logs", "update"), h(async (req, res) => {
    if (scope === "super" && /^[a-f0-9]{24}$/.test(String(req.query.companyId || ""))) setTenantDb(await dbOf(req.query.companyId));
    const log = await WaLog.findOne({ _id: req.params.id, ...(scope === "company" ? { companyId: req.auth!.companyId } : {}) }).lean();
    if (!log) throw notFound();
    res.locals.action = "Resend";
    res.locals.item = `${(log as any).event} → ${(log as any).to}`;
    res.json(await resendLog(log, req.auth!.email));
  }));
  return r;
}

/* ───────────── Activity Logs ───────────── */

export function activityRoutes(scope: Scope) {
  const r = Router();
  r.get("/", can("activity_logs", "read"), h(async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const side = scope === "super" && req.query.side === "company" ? "company" : scope;
    const q: any = { scope: side, ...dateRange(req.query) };
    if (scope === "company") q.companyId = req.auth!.companyId;
    else if (side === "company" && req.query.companyId) q.companyId = req.query.companyId;
    if (req.query.module) q.module = req.query.module;
    if (req.query.q) q.$or = [{ userLabel: { $regex: escapeRegex(String(req.query.q)), $options: "i" } }, { item: { $regex: escapeRegex(String(req.query.q)), $options: "i" } }];
    let items: any[];
    let total: number;
    if (scope === "super" && side === "company") {
      if (q.companyId) {
        setTenantDb(await dbOf(q.companyId));
        [items, total] = await Promise.all([ActivityLog.find(q).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(), ActivityLog.countDocuments(q)]);
      } else {
        // all companies: newest first across every company database (each contributes at most skip+limit rows)
        const per = await forEachCompanyDb(async (co) => {
          const qq = { ...q, companyId: co._id };
          const [rows, n] = await Promise.all([ActivityLog.find(qq).sort({ createdAt: -1 }).limit(skip + limit).lean(), ActivityLog.countDocuments(qq)]);
          return { rows, n };
        });
        total = per.reduce((a, p) => a + p.value.n, 0);
        items = per.flatMap((p) => p.value.rows).sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(skip, skip + limit);
      }
    } else [items, total] = await Promise.all([ActivityLog.find(q).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(), ActivityLog.countDocuments(q)]);
    let companies: Record<string, string> = {};
    if (scope === "super" && side === "company") {
      const ids = [...new Set(items.map((i: any) => String(i.companyId)))];
      const cs = await Company.find({ _id: { $in: ids } }).select("name").lean();
      companies = Object.fromEntries(cs.map((c: any) => [String(c._id), c.name]));
    }
    res.json({ items: items.map((i: any) => ({ ...i, companyName: companies[String(i.companyId)] })), total, page, limit });
  }));
  return r;
}

/* ───────────── Role Management ───────────── */

const permSchema = z.record(z.object({ create: z.boolean(), read: z.boolean(), update: z.boolean(), delete: z.boolean() }));

/** Clamp a role grid to what the company may use (plan + Super Admin's per-company overrides, sub-modules included). */
export async function clampToPlan(planName: string, perms: PermMap, access?: any): Promise<PermMap> {
  const { caps } = await companyCaps(planName, access);
  const out: PermMap = {};
  for (const m of COMPANY_MODULES) {
    const p = perms[m.key] || ({} as any);
    const cap = caps[m.key] || ({} as any);
    out[m.key] = Object.fromEntries(ACTIONS.map((a) => [a, !!(p[a] && cap[a])])) as any;
    // sub-modules the role sets explicitly (others inherit the module): only applicable actions, within the caps
    for (const s of m.subs || []) {
      const k = `${m.key}:${s.key}`;
      const ps = perms[k];
      if (ps) out[k] = Object.fromEntries(ACTIONS.map((a) => [a, !!(ps[a] && s.actions.includes(a) && cap[a] && p[a] && caps[k]?.[a] !== false)])) as any;
    }
  }
  return out;
}
const accessOf = async (req: Request, scope: Scope) => (scope === "company" ? (await runInMain(() => Company.findById(req.auth!.companyId).select("moduleAccess").lean<any>()))?.moduleAccess : undefined);

export function roleRoutes(scope: Scope) {
  const r = Router();
  const base = (req: Request) => (scope === "company" ? { scope: "company", companyId: req.auth!.companyId } : { scope: "super" });

  // Users › assign-role also needs the role list (names only), so either sub-module may read it.
  r.get("/", can("roles", "read"), h(async (req, res) => {
    if (!permOf(req.auth?.perms, "roles:roles")?.read && !permOf(req.auth?.perms, "roles:users")?.read) throw forbidden("No read access to roles › roles");
    const q: any = base(req);
    if (scope === "super" && req.query.plan) q.plan = req.query.plan;
    const roles = await Role.find(q).sort({ name: 1 }).lean();
    const plan = scope === "company" ? null : req.query.plan ? await Plan.findOne({ name: req.query.plan }).lean<any>() : null;
    let templates: any[] = [];
    if (scope === "company") templates = await runInMain(() => Role.find({ scope: "super", plan: req.auth!.plan }).lean()); // platform templates
    // company grid: capped by the plan and the Super Admin's overrides for this company (paused modules can't be granted)
    const caps = scope === "company" ? (await companyCaps(req.auth!.plan!, await accessOf(req, scope))).caps : plan?.permissions || null;
    res.json({ roles, modules: COMPANY_MODULES, planCaps: caps, templates });
  }));

  r.post("/", can("roles:roles", "create"), h(async (req, res) => {
    const b = parse(z.object({ name: z.string().min(2).max(60), plan: z.string().optional(), permissions: permSchema }), req.body);
    const planName = scope === "company" ? req.auth!.plan! : b.plan;
    if (!planName) throw badRequest("Select a plan");
    const role = await Role.create({ ...base(req), name: b.name, plan: planName, permissions: await clampToPlan(planName, b.permissions as PermMap, await accessOf(req, scope)) });
    res.locals.item = role.name;
    res.status(201).json(role);
  }));

  r.put("/:id", can("roles:roles", "update"), h(async (req, res) => {
    const b = parse(z.object({ name: z.string().min(2).max(60).optional(), permissions: permSchema.optional() }), req.body);
    const role = await Role.findOne({ _id: req.params.id, ...base(req) });
    if (!role) throw notFound();
    if (b.name) role.name = b.name;
    if (b.permissions) role.permissions = await clampToPlan(role.plan, b.permissions as PermMap, await accessOf(req, scope));
    role.markModified("permissions");
    await role.save();
    await invalidateAuth();
    res.locals.item = role.name;
    res.json(role);
  }));

  r.delete("/:id", can("roles:roles", "delete"), h(async (req, res) => {
    const d = await Role.findOneAndDelete({ _id: req.params.id, ...base(req) });
    if (!d) throw notFound();
    await invalidateAuth();
    res.locals.item = d.name;
    res.json({ ok: true });
  }));
  return r;
}

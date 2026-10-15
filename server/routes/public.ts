import { Router } from "express";
import { Connector, IntakeEvent, Company, Lead, Webhook, ConnectorKey, EndpointKey, AiEndpoint } from "../models";
import { endpointChat } from "../lib/agentic";
import { h, HttpError } from "../lib/http";
import { decrypt, hmacValid, sha256 } from "../lib/crypto";
import { processIntake, runEvent } from "../lib/intake";
import { fireEvent } from "../lib/whatsapp";
import { cached, rateLimit } from "../lib/cache";
import { getObject } from "../lib/s3";
import { runBillingJobs } from "../lib/billing";
import { setTenantDb } from "../lib/context";
import { forEachCompanyDb, inCompanyDb, sweepStragglers } from "../lib/tenantdb";
import { runPullConnectors } from "../lib/pull";
import { requestHost, resolveHost, baseDomain, publicBranding, platformBranding } from "../lib/tenant";
import { LOST_STATUS, WON_STATUS } from "../../shared/constants";

const r = Router();

/** Public key → company database (registry in the main database) → connector in that company's database. */
async function loadConnector(key: string) {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(key)) throw new HttpError(404, "Unknown or inactive connector");
  const reg = await cached(`conn:reg:${key}`, 60, () => ConnectorKey.findOne({ key }).lean<any>());
  if (reg) setTenantDb(reg.db);
  const c = await cached(`conn:${key}`, 60, () => Connector.findOne({ key, active: true }).lean<any>());
  if (!c) throw new HttpError(404, "Unknown or inactive connector");
  const company = await cached(`conn:co:${c.companyId}`, 60, () => Company.findOne({ _id: c.companyId, status: "active", deletedAt: null }).select("_id").lean());
  if (!company) throw new HttpError(403, "Company inactive");
  return c;
}

/** Meta (Facebook / Instagram / WhatsApp Cloud) webhook verification handshake. */
r.get("/intake/:key", h(async (req, res) => {
  const c = await loadConnector(req.params.key);
  if (req.query["hub.mode"] === "subscribe") {
    const expected = c.verifyToken || decrypt(c.secretEnc);
    if (req.query["hub.verify_token"] === expected) return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
    throw new HttpError(403, "Verify token mismatch");
  }
  res.json({ ok: true, connector: c.name, type: c.type });
}));

/**
 * Unified lead intake.
 * Auth (any one): `x-api-key` header · `x-signature: sha256=<hmac of raw body>` · `?key=` · google_key in body (Google Ads)
 * Browser forms (website_form / qr_campaign) may post without a key; they must pass the honeypot.
 * Idempotency: `Idempotency-Key` header, else provider id, else hash of the body.
 */
r.post("/intake/:key", h(async (req, res) => {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (!(await rateLimit(`intake:${req.params.key}|${ip}`, 120, 60))) throw new HttpError(429, "Rate limit exceeded");
  const c = await loadConnector(req.params.key);
  const secret = decrypt(c.secretEnc);
  const body = req.body || {};
  const isBrowserForm = ["website_form", "qr_campaign"].includes(c.type) && !!req.headers.origin;

  const authed =
    (req.headers["x-api-key"] && req.headers["x-api-key"] === secret) ||
    req.query.key === secret ||
    (c.type === "google_ads" && body.google_key === secret) ||
    hmacValid(secret, req.rawBody || "", (req.headers["x-signature"] || req.headers["x-hub-signature-256"]) as string) ||
    (c.type === "meta_leads" && body.object === "page") || // Meta posts after the verify handshake; lead data is re-fetched with the page token
    (c.type === "whatsapp" && body.object === "whatsapp_business_account");

  if (!authed && !isBrowserForm) throw new HttpError(401, "Invalid connector key or signature");
  if (isBrowserForm && (body._hp || body.website_url_hp)) return res.json({ ok: true }); // bot honeypot: pretend success

  delete body._hp;
  delete body.google_key;
  const idem = (req.headers["idempotency-key"] || req.headers["x-idempotency-key"]) as string | undefined;
  const result = await processIntake(c, body, idem);

  // Meta & WhatsApp expect 200 quickly or they retry — failures are retried by our cron instead.
  if (["meta_leads", "whatsapp"].includes(c.type)) return res.status(200).json({ received: true });
  if (req.headers.accept?.includes("text/html") && isBrowserForm) return res.redirect(303, `/f/${c.key}?ok=1`);
  res.status((result as any).ok === false ? 202 : 200).json(result);
}));

/* ───────────── AI endpoint for external systems ─────────────
 * POST /api/ai/v1/chat   Authorization: Bearer ep_live_…   { "question": "…", "history": [{role, content}] }
 * → { "answer": "…", "usage": { credits, remaining } }
 * The key decides the company and its database; the endpoint's AI model may read only that database.
 */
r.post("/ai/v1/chat", h(async (req, res) => {
  const origin = req.headers.origin as string | undefined;
  const raw = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || String(req.headers["x-api-key"] || "");
  if (!/^ep_live_[A-Za-z0-9_-]{20,80}$/.test(raw)) throw new HttpError(401, "Missing or invalid API key");
  const reg = await cached(`ep:key:${sha256(raw)}`, 60, () => EndpointKey.findOne({ keyHash: sha256(raw) }).lean<any>());
  if (!reg) throw new HttpError(401, "Missing or invalid API key");
  setTenantDb(reg.db);
  const ep = await cached(`ep:${reg.endpointId}`, 30, () => AiEndpoint.findOne({ _id: reg.endpointId, active: true }).lean<any>());
  if (!ep) throw new HttpError(403, "This endpoint is switched off");
  if (origin) {
    if (!(ep.allowedOrigins || []).includes(origin)) throw new HttpError(403, "This website is not allowed to call the endpoint");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (!(await rateLimit(`ep:rl:${ep._id}`, ep.rateLimitPerMin || 60, 60))) throw new HttpError(429, "Rate limit reached — slow down");
  const company = await cached(`ep:co:${reg.companyId}`, 120, () => Company.findOne({ _id: reg.companyId, status: "active", deletedAt: null }).select("name").lean<any>());
  if (!company) throw new HttpError(403, "Company inactive");
  const b = req.body || {};
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 4000) : "";
  if (!question) throw new HttpError(400, 'Send JSON like {"question": "…"}');
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((m: any) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-10)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const out: any = await endpointChat(ep, company, [...history, { role: "user", content: question }]);
  await AiEndpoint.updateOne({ _id: ep._id }, { $inc: { "stats.calls": 1, "stats.credits": out.usage?.credits || 0 }, $set: { "stats.lastAt": new Date() } });
  res.json({ answer: out.text, usage: out.usage ? { credits: out.usage.credits, remaining: out.usage.remaining } : undefined });
}));

/* ───────────── White-label branding (login page, favicon, theme) ───────────── */

/** Which login to show for this host: the platform (Super Admin) or a company's branded login. */
r.get("/public/branding", h(async (req, res) => {
  const host = requestHost(req);
  const t = await resolveHost(host);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  if (t.kind === "company") return res.json({ ...publicBranding(t.company), host });
  if (t.kind === "platform") return res.json({ ...platformBranding(), host });
  res.status(404).json({ error: "No workspace is set up for this address.", host, baseDomain: baseDomain() || null });
}));

/** Streams a company's logo / banner / favicon from the private S3 bucket. */
r.get("/public/brand-asset/:companyId/:kind", h(async (req, res) => {
  const kind = req.params.kind as "logo" | "banner" | "favicon";
  if (!["logo", "banner", "favicon"].includes(kind)) throw new HttpError(404, "Not found");
  const c = await Company.findOne({ _id: req.params.companyId, deletedAt: null }).select("branding").lean<any>();
  const key = c?.branding?.[`${kind}Key`];
  if (!key) throw new HttpError(404, "Not found");
  const obj = await getObject(key);
  res.setHeader("Content-Type", obj.contentType);
  res.setHeader("Cache-Control", "public, max-age=86400, immutable"); // URL carries ?v=<updatedAt>
  res.send(obj.body);
}));

/** Public info for the hosted QR / campaign form page. */
r.get("/forms/:key", h(async (req, res) => {
  const c = await loadConnector(req.params.key);
  if (!["qr_campaign", "website_form"].includes(c.type)) throw new HttpError(404, "Not a form connector");
  const company = await Company.findById(c.companyId).lean<any>();
  const brand = company ? publicBranding(company) : null;
  res.json({ title: c.name, company: brand?.shortName || company?.name, campaign: c.defaultCampaign, logoUrl: brand?.logoUrl, themeColor: brand?.themeColor, accentColor: brand?.accentColor });
}));

/* ───────────── Vercel Cron ───────────── */
function cronAuth(req: any) {
  const s = process.env.CRON_SECRET;
  if (s) {
    if (req.headers.authorization !== `Bearer ${s}`) throw new HttpError(401, "Unauthorized cron");
    return;
  }
  // No secret configured: only Vercel's scheduler (or local dev) may trigger jobs
  const ua = String(req.headers["user-agent"] || "");
  if (process.env.VERCEL && !ua.startsWith("vercel-cron/")) throw new HttpError(401, "Set CRON_SECRET to trigger cron jobs manually");
}

/** Every 15 min: retry failed intake deliveries whose backoff has elapsed. */
r.get("/cron/retry", h(async (req, res) => {
  cronAuth(req);
  let retried = 0;
  let ok = 0;
  await forEachCompanyDb(async () => {
    const due = await IntakeEvent.find({ status: "failed", nextAttemptAt: { $lte: new Date() } }).limit(50).lean<any[]>();
    for (const ev of due) {
      const c = await Connector.findById(ev.connectorId).lean();
      if (!c) continue;
      retried++;
      const r2: any = await runEvent(c, ev._id, ev.payload);
      if (r2.ok) ok++;
    }
  });
  const moved = await sweepStragglers().catch(() => 0);
  res.json({ retried, ok, moved });
}));

/** Daily 02:00 IST: pull connectors — Google Search keyword prospecting and MCP servers. */
r.get("/cron/pull", h(async (req, res) => {
  cronAuth(req);
  res.json(await runPullConnectors());
}));

/** Daily 02:00 IST: AI allocation renewals, subscription cycles, Unpaid → Over Due → Expired, 1/3/7-day reminders. */
r.get("/cron/billing", h(async (req, res) => {
  cronAuth(req);
  res.json(await runBillingJobs());
}));

/** Daily 08:00 IST: follow-up digest per company (event: followup_digest). */
r.get("/cron/followups", h(async (req, res) => {
  cronAuth(req);
  const per = await forEachCompanyDb(async (co) => ((await Webhook.exists({ scope: "company", companyId: co._id, event: "followup_digest", active: true })) ? String(co._id) : null));
  const companyIds = per.map((x) => x.value).filter(Boolean) as string[];
  let sent = 0;
  for (const cid of companyIds) {
    await inCompanyDb(cid, async () => {
    const company = await Company.findOne({ _id: cid, status: "active", deletedAt: null }).lean<any>();
    if (!company?.whatsapp) return;
    const due = await Lead.find({ companyId: cid, deletedAt: null, status: { $nin: [LOST_STATUS, WON_STATUS] }, $or: [{ status: "Follow-ups needed" }, { nextFollowUpAt: { $lte: new Date(Date.now() + 86400_000) } }] }).limit(40).select("name phone status").lean<any[]>();
    const fresh = await Lead.countDocuments({ companyId: cid, deletedAt: null, status: "New" });
    if (!due.length && !fresh) return;
    const message = [`Good morning! ${company.name} lead digest:`, `• ${fresh} new lead(s) not yet contacted`, `• ${due.length} follow-up(s) due today`, "", ...due.map((l, i) => `${i + 1}. ${l.name || "—"} (${l.phone || ""}) – ${l.status}`)].join("\n");
    const r2 = await fireEvent("company", cid, "followup_digest", { phone: company.whatsapp, name: company.contactPerson, company: company.name, message, params: { new: fresh, due: due.length } }, "cron");
    sent += r2.sent;
    });
  }
  res.json({ companies: companyIds.length, sent });
}));

export default r;

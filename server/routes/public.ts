import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { createTicket } from "./co/clients";
import { refreshBilling } from "../lib/clients";
import { Connector, IntakeEvent, Company, Lead, Webhook, ConnectorKey, EndpointKey, AiEndpoint, SupportTicket } from "../models";
import { endpointChat } from "../lib/agentic";
import { h, HttpError } from "../lib/http";
import { decrypt, hmacValid, hmacB64Valid, sha256 } from "../lib/crypto";
import { processIntake, runEvent } from "../lib/intake";
import { fireEvent } from "../lib/whatsapp";
import { cached, rateLimit } from "../lib/cache";
import { getObject } from "../lib/s3";
import { runBillingJobs } from "../lib/billing";
import { setTenantDb } from "../lib/context";
import { forEachCompanyDb, inCompanyDb, sweepStragglers } from "../lib/tenantdb";
import { runPullConnectors } from "../lib/pull";
import { prospectWorker } from "../lib/prospect";
import { requestHost, resolveHost, baseDomain, publicBranding, platformBranding, loadPlatformBranding } from "../lib/tenant";
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
const PUSH_PLATFORMS = ["indiamart", "justdial", "sulekha"];
const ipOf = (req: any) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

/** Strip auth/transport keys so they never land on the lead. */
function cleanPayload(o: any) {
  const p = { ...(o || {}) };
  for (const k of ["key", "token", "_hp", "google_key"]) delete p[k];
  return p;
}

async function receive(req: any, res: any, c: any, body: any) {
  const idem = (req.headers["idempotency-key"] || req.headers["x-idempotency-key"]) as string | undefined;
  const result: any = await processIntake(c, body, idem);
  // Platforms that retry on non-200 (and may switch the integration off) always get 200 — our own retry queue
  // (Deliveries tab, every 15 minutes) re-processes anything that failed.
  if (["meta_leads", "whatsapp", "indiamart", "sulekha", "shopify", "woocommerce"].includes(c.type)) return res.status(200).json({ received: true, ...(result.ignored ? { ignored: result.ignored } : {}) });
  if (c.type === "justdial") return res.status(200).type("text/plain").send("RECEIVED");
  return res.status(result.ok === false ? 202 : 200).json(result);
}

/** GET: Meta verification handshake; JustDial / Sulekha push leads as query parameters on GET. */
r.get(["/intake/:key", "/intake/:key/:token"], h(async (req, res) => {
  const c = await loadConnector(req.params.key);
  if (req.query["hub.mode"] === "subscribe") {
    const expected = c.verifyToken || decrypt(c.secretEnc);
    if (req.query["hub.verify_token"] === expected) return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
    throw new HttpError(403, "Verify token mismatch");
  }
  const secret = decrypt(c.secretEnc);
  const authed = (req.params.token && req.params.token === secret) || req.query.key === secret;
  const data = cleanPayload(req.query);
  if (PUSH_PLATFORMS.includes(c.type) && Object.keys(data).length) {
    if (!authed) throw new HttpError(401, "Invalid lead URL — copy it again from the connector");
    if (!(await rateLimit(`intake:${req.params.key}|${ipOf(req)}`, 300, 60))) throw new HttpError(429, "Rate limit exceeded");
    return receive(req, res, c, data);
  }
  res.json({ ok: true, connector: c.name, type: c.type, ready: true }); // connectivity check ("Test URL" in the platforms' panels)
}));

/**
 * Unified lead intake.
 * Auth (any one): `x-api-key` header · `x-signature: sha256=<hmac of raw body>` · `?key=` · token path segment
 * (/intake/<key>/<token> — used for IndiaMART, JustDial, Sulekha and Shopify, which can't send headers) · google_key in body (Google Ads).
 * Browser forms (website_form / qr_campaign) may post without a key; they must pass the honeypot.
 * Idempotency: `Idempotency-Key` header, else the platform's lead id, else hash of the body.
 */
r.post(["/intake/:key", "/intake/:key/:token"], h(async (req, res) => {
  if (!(await rateLimit(`intake:${req.params.key}|${ipOf(req)}`, 300, 60))) throw new HttpError(429, "Rate limit exceeded");
  const c = await loadConnector(req.params.key);
  const secret = decrypt(c.secretEnc);
  const body = { ...(req.body || {}), ...(PUSH_PLATFORMS.includes(c.type) && req.body && !Object.keys(req.body).length ? req.query : {}) };
  const isBrowserForm = ["website_form", "qr_campaign"].includes(c.type) && !!req.headers.origin;
  const tokenOk = !!req.params.token && req.params.token === secret;

  // Shops sign every delivery: base64 HMAC-SHA256 of the raw body.
  // Shopify: with the store's webhook signing key saved in Settings the signature is required; until then the Lead URL token is.
  // WooCommerce: the webhook "Secret" is this connector's secret. Saving a webhook sends an unsigned ping {webhook_id} — acknowledged only.
  if (c.type === "shopify" || c.type === "woocommerce") {
    const raw = req.rawBody || "";
    let ok: boolean;
    if (c.type === "shopify") {
      const signingKey = decrypt(c.configSecretEnc);
      ok = signingKey ? hmacB64Valid(signingKey, raw, req.headers["x-shopify-hmac-sha256"] as string) : tokenOk;
      body._topic = String(req.headers["x-shopify-topic"] || "");
    } else {
      const ping = body.webhook_id != null && Object.keys(body).length === 1 && !req.headers["x-wc-webhook-signature"];
      if (ping) return res.status(200).json({ ok: true, ping: true });
      ok = hmacB64Valid(secret, raw, req.headers["x-wc-webhook-signature"] as string) || tokenOk;
      body._topic = String(req.headers["x-wc-webhook-topic"] || "");
    }
    if (!ok) throw new HttpError(401, c.type === "shopify" ? "Signature check failed — check the webhook signing key in the connector's Settings" : "Signature check failed — the WooCommerce webhook Secret must be this connector's secret");
    return receive(req, res, c, body);
  }

  const authed =
    tokenOk ||
    (req.headers["x-api-key"] && req.headers["x-api-key"] === secret) ||
    req.query.key === secret ||
    (c.type === "google_ads" && body.google_key === secret) ||
    hmacValid(secret, req.rawBody || "", (req.headers["x-signature"] || req.headers["x-hub-signature-256"]) as string) ||
    (c.type === "meta_leads" && body.object === "page") || // Meta posts after the verify handshake; lead data is re-fetched with the page token
    (c.type === "whatsapp" && body.object === "whatsapp_business_account");

  if (!authed && !isBrowserForm) throw new HttpError(401, c.type === "google_ads" ? "Invalid key — paste the connector's key into the Google Ads lead form webhook" : "Invalid connector key or signature");
  if (isBrowserForm && (body._hp || body.website_url_hp)) return res.json({ ok: true }); // bot honeypot: pretend success

  if (req.headers.accept?.includes("text/html") && isBrowserForm) {
    await processIntake(c, cleanPayload(body)); // classic HTML form post → back to the hosted thank-you page
    return res.redirect(303, `/f/${c.key}?ok=1`);
  }
  return receive(req, res, c, cleanPayload(body));
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

/* ───────────── Client support portal (https://support.<company address>, or <company address>/support) ─────────────
 * The client proves who they are with their Client ID + the mobile number registered with the company, and gets a
 * signed 2-hour session. They can raise a ticket (Support / Request / Grievance) and follow its status; every status
 * change is also sent to them on WhatsApp by the company's "Support ticket" webhooks.
 */
const SUP_SECRET = () => process.env.JWT_SECRET || process.env.DATA_ENCRYPTION_KEY || "dev-insecure-key";
const signSup = (o: any) => {
  const body = Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${body}.${createHmac("sha256", SUP_SECRET()).update(`sup.${body}`).digest("base64url")}`;
};
function readSup(token?: string) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", SUP_SECRET()).update(`sup.${body}`).digest("base64url");
  if (want.length !== mac.length || !timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  const o = JSON.parse(Buffer.from(body, "base64url").toString());
  return o.exp > Date.now() ? o : null;
}

/** Company for the support portal: the address it's opened on (support.<company address> or <company address>/support). */
async function supportCompany(req: any) {
  const host = requestHost(req);
  const t = await resolveHost(host);
  let company: any = t.kind === "company" ? t.company : null;
  // platform address / local testing: ?c=<short name>
  if (!company && t.kind !== "unknown" && req.query.c) company = await Company.findOne({ slug: String(req.query.c).toLowerCase(), deletedAt: null }).lean();
  if (!company || company.status !== "active") throw new HttpError(404, "No support page is set up at this address");
  return company;
}

r.get("/public/support/info", h(async (req, res) => {
  const c = await supportCompany(req);
  const b = publicBranding(c);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ name: b.name, shortName: b.shortName, tagline: b.tagline, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl, themeColor: b.themeColor, accentColor: b.accentColor, supportEmail: b.supportEmail, supportPhone: b.supportPhone, categories: ["Support", "Request", "Grievance"] });
}));

r.post("/public/support/session", h(async (req, res) => {
  const c = await supportCompany(req);
  const b = req.body || {};
  const code = String(b.clientId || "").trim().toUpperCase();
  const digits = String(b.phone || "").replace(/\D/g, "").slice(-10);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code) || digits.length !== 10) throw new HttpError(400, "Enter your Client ID and the 10-digit mobile number registered with us");
  const ip = ipOf(req);
  if (!(await rateLimit(`sup:ip:${ip}`, 20, 600)) || !(await rateLimit(`sup:id:${c._id}:${code}`, 8, 600))) throw new HttpError(429, "Too many attempts — please try again in 10 minutes");
  const client = await inCompanyDb(c._id, () => Lead.findOne({ companyId: c._id, clientCode: code, isClient: true, deletedAt: null }).select("name phone whatsapp business.ownerPhone clientCode").lean<any>());
  const nums = client ? [client.whatsapp, client.phone, client.business?.ownerPhone].filter(Boolean).map((x: string) => String(x).replace(/\D/g, "").slice(-10)) : [];
  if (!client || !nums.includes(digits)) throw new HttpError(401, "Client ID and mobile number don't match our records");
  const first = String(client.name || "").split(" ")[0];
  res.json({ token: signSup({ c: String(c._id), l: String(client._id), exp: Date.now() + 2 * 3600_000 }), client: { clientId: client.clientCode, name: first || "there" } });
}));

async function supportSession(req: any) {
  const s = readSup(req.headers["x-support-token"] as string);
  if (!s) throw new HttpError(401, "Your session has ended — please sign in again");
  const c = await supportCompany(req);
  if (String(c._id) !== s.c) throw new HttpError(401, "Please sign in again");
  return { company: c, leadId: s.l };
}

r.get("/public/support/tickets", h(async (req, res) => {
  const { company, leadId } = await supportSession(req);
  const rows = await inCompanyDb(company._id, () => SupportTicket.find({ companyId: company._id, clientId: leadId }).sort({ createdAt: -1 }).limit(50).select("ticketNo category description status createdAt updatedAt history.at history.to history.note").lean<any[]>());
  res.setHeader("Cache-Control", "no-store");
  res.json(rows.map((t) => ({ ...t, history: (t.history || []).filter((x: any) => x.to) })));
}));

r.post("/public/support/tickets", h(async (req, res) => {
  const { company, leadId } = await supportSession(req);
  const b = req.body || {};
  if (!["Support", "Request", "Grievance"].includes(b.category)) throw new HttpError(400, "Choose a category");
  const description = String(b.description || "").trim();
  if (description.length < 10) throw new HttpError(400, "Please describe what you need (at least 10 characters)");
  if (description.length > 4000) throw new HttpError(400, "Please keep it under 4000 characters");
  if (!(await rateLimit(`sup:new:${leadId}`, 10, 3600))) throw new HttpError(429, "You've raised several tickets in the last hour — our team will get back to you");
  const t = await inCompanyDb(company._id, async () => {
    const client = await Lead.findOne({ _id: leadId, isClient: true, deletedAt: null }).select("name phone whatsapp business.ownerPhone clientCode companyId").lean<any>();
    if (!client) throw new HttpError(401, "Please sign in again");
    return createTicket(client, b.category, description, "portal");
  });
  res.status(201).json({ ticketNo: t.ticketNo, status: t.status, createdAt: t.createdAt });
}));

/* ───────────── White-label branding (login page, favicon, theme) ───────────── */

/** Which login to show for this host: the platform (Super Admin) or a company's branded login. */
r.get("/public/branding", h(async (req, res) => {
  const host = requestHost(req);
  const t = await resolveHost(host);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  if (t.kind === "company") return res.json({ ...publicBranding(t.company), host });
  if (t.kind === "platform") {
    await loadPlatformBranding();
    return res.json({ ...platformBranding(), host });
  }
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

/** Daily 02:00 IST: MCP server connectors. */
r.get("/cron/pull", h(async (req, res) => {
  cronAuth(req);
  res.json(await runPullConnectors("daily"));
}));

/** Every 15 minutes: Public Web Prospecting — seeds each connector daily from 02:00 IST, then reads its queue in time-boxed slices. */
r.get("/cron/prospect", h(async (req, res) => {
  cronAuth(req);
  res.json(await prospectWorker());
}));

/** Every 15 minutes: IndiaMART Pull API, TradeIndia My Inquiry API, WooCommerce REST safety net. */
r.get("/cron/pull-frequent", h(async (req, res) => {
  cronAuth(req);
  res.json(await runPullConnectors("frequent"));
}));

/** Daily 02:00 IST: AI allocation renewals, subscription cycles, Unpaid → Over Due → Expired, 1/3/7-day reminders. */
r.get("/cron/billing", h(async (req, res) => {
  cronAuth(req);
  const platform = await runBillingJobs();
  // Client module: generate this period's recurring dues and mark unpaid past-due ones Over-Due, in every company
  const clients = await forEachCompanyDb(async (co) => (co.db ? refreshBilling(co._id, true).then(() => 1) : 0), { concurrency: 6 });
  res.json({ ...platform, clientBilling: { companies: clients.reduce((a: number, x: any) => a + (x.value || 0), 0) } });
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

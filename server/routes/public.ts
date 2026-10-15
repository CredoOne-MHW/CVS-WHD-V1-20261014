import { Router } from "express";
import { Connector, IntakeEvent, Company, Lead, Webhook } from "../models";
import { h, HttpError } from "../lib/http";
import { decrypt, hmacValid } from "../lib/crypto";
import { processIntake, runEvent } from "../lib/intake";
import { fireEvent } from "../lib/whatsapp";
import { getObject } from "../lib/s3";
import { requestHost, resolveHost, baseDomain, publicBranding, platformBranding } from "../lib/tenant";
import { LOST_STATUS, WON_STATUS } from "../../shared/constants";

const r = Router();

// naive per-instance rate limit for public intake (pair with Vercel Firewall rules)
const hits = new Map<string, { n: number; reset: number }>();
function rateLimit(key: string, max = 60) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) return void hits.set(key, { n: 1, reset: now + 60_000 });
  if (++e.n > max) throw new HttpError(429, "Rate limit exceeded");
}

async function loadConnector(key: string) {
  const c = await Connector.findOne({ key, active: true }).lean<any>();
  if (!c) throw new HttpError(404, "Unknown or inactive connector");
  const company = await Company.findOne({ _id: c.companyId, status: "active", deletedAt: null }).select("_id").lean();
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
  rateLimit(`${req.params.key}|${req.headers["x-forwarded-for"] || req.socket.remoteAddress}`, 120);
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
  if (s && req.headers.authorization !== `Bearer ${s}`) throw new HttpError(401, "Unauthorized cron");
}

/** Every 15 min: retry failed intake deliveries whose backoff has elapsed. */
r.get("/cron/retry", h(async (req, res) => {
  cronAuth(req);
  const due = await IntakeEvent.find({ status: "failed", nextAttemptAt: { $lte: new Date() } }).limit(50).lean<any[]>();
  let ok = 0;
  for (const ev of due) {
    const c = await Connector.findById(ev.connectorId).lean();
    if (!c) continue;
    const r2: any = await runEvent(c, ev._id, ev.payload);
    if (r2.ok) ok++;
  }
  res.json({ retried: due.length, ok });
}));

/** Daily 08:00 IST: follow-up digest per company (event: followup_digest). */
r.get("/cron/followups", h(async (req, res) => {
  cronAuth(req);
  const hooks = await Webhook.find({ scope: "company", event: "followup_digest", active: true }).select("companyId").lean<any[]>();
  const companyIds = [...new Set(hooks.map((x) => String(x.companyId)))];
  let sent = 0;
  for (const cid of companyIds) {
    const company = await Company.findOne({ _id: cid, status: "active", deletedAt: null }).lean<any>();
    if (!company?.whatsapp) continue;
    const due = await Lead.find({ companyId: cid, deletedAt: null, status: { $nin: [LOST_STATUS, WON_STATUS] }, $or: [{ status: "Follow-ups needed" }, { nextFollowUpAt: { $lte: new Date(Date.now() + 86400_000) } }] }).limit(40).select("name phone status").lean<any[]>();
    const fresh = await Lead.countDocuments({ companyId: cid, deletedAt: null, status: "New" });
    if (!due.length && !fresh) continue;
    const message = [`Good morning! ${company.name} lead digest:`, `• ${fresh} new lead(s) not yet contacted`, `• ${due.length} follow-up(s) due today`, "", ...due.map((l, i) => `${i + 1}. ${l.name || "—"} (${l.phone || ""}) – ${l.status}`)].join("\n");
    const r2 = await fireEvent("company", cid, "followup_digest", { phone: company.whatsapp, name: company.contactPerson, company: company.name, message, params: { new: fresh, due: due.length } }, "cron");
    sent += r2.sent;
  }
  res.json({ companies: companyIds.length, sent });
}));

export default r;

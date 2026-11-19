import { normalise as normaliseForm, validate as validateForm, visible as visibleFields } from "@shared/formspec";
import { BRAND_ASSET_KINDS, mobileBrand } from "@shared/mobilebrand";
import { pump } from "../lib/jobs";
import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { createTicket } from "./co/clients";
import { refreshBilling } from "../lib/clients";
import { Connector, IntakeEvent, Company, Lead, Webhook, ConnectorKey, EndpointKey, AiEndpoint, SupportTicket, DpdpDocument, ServiceType } from "../models";
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
import { runFor, runPlatform } from "../lib/cron";
import { runJobForCompany, activeCompanies } from "../lib/cronjobs";
import { requestHost, resolveHost, baseDomain, publicBranding, platformBranding, loadPlatformBranding } from "../lib/tenant";
import { LOST_STATUS, WON_STATUS } from "../../shared/constants";
import { getCompliance, platformUrl } from "../lib/oauth";
import { CONSENT_VERSION } from "../../shared/sso";

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
  // Hosted QR forms post without a key (honeypot-protected). Website forms are REST API / webhook now (API key or
  // signature); only website-form connectors created before that change may still post from a browser without a key.
  const isBrowserForm = (c.type === "qr_campaign" || (c.type === "website_form" && c.authMode !== "key")) && !!req.headers.origin;
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
    (c.type === "meta_leads" && body.object === "page") || // retired App-ID setup: lead data is re-fetched with the page token
    (c.type === "whatsapp" && c.authMode !== "key" && body.object === "whatsapp_business_account"); // older WhatsApp connectors only

  if (!authed && !isBrowserForm)
    throw new HttpError(
      401,
      c.type === "google_ads"
        ? "Invalid key — paste the connector's key into the Google Ads lead form webhook"
        : c.type === "whatsapp"
          ? "Missing or invalid API key — use the Callback URL with ?key=… (or send x-api-key) from the connector's Setup tab"
          : "Missing or invalid API key — send the x-api-key header (or ?key=…) shown on the connector's Setup tab"
    );
  const formPost = isBrowserForm || c.type === "website_form";
  if (formPost && (body._hp || body.website_url_hp)) return res.json({ ok: true }); // bot honeypot: pretend success

  /*
   * A company that has edited its own form gets its rules enforced here as well as in the browser.
   *
   * This endpoint is public, so the browser's `required` attributes are a courtesy to the visitor and
   * nothing more — anything can post here directly. Only connectors with a saved form are checked: one
   * that has never been edited behaves exactly as it always has, which also keeps every REST and webhook
   * caller of a website-form connector working untouched.
   */
  if (isBrowserForm && c.config?.form) {
    const problem = validateForm(normaliseForm(c.config.form), body);
    if (problem) throw new HttpError(400, problem);
  }

  if (req.headers.accept?.includes("text/html") && formPost) {
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

const requestIp = (req: any) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

/* ───────────────────────── DPDP consent (public) ─────────────────────────
 * The notice the website, the apps and the CRM open. The screen tracks how far it was scrolled and how long
 * it was open, and the accept call checks the same thing again on the server — a screen is only a screen.
 */

/** The company the consent link belongs to: its own address, or ?c=<short name> on the platform address. */
async function consentCompany(req: any) {
  const t = await resolveHost(requestHost(req));
  let company: any = t.kind === "company" ? t.company : null;
  if (!company && req.query.c) company = await Company.findOne({ slug: String(req.query.c).toLowerCase(), deletedAt: null }).lean();
  if (!company || company.status !== "active") throw new HttpError(404, "No consent notice is published at this address");
  return company;
}

r.get("/public/consent", h(async (req, res) => {
  const c = await consentCompany(req);
  const { noticeFor } = await import("../lib/dpdp");
  const { DPDP_PURPOSES, COOKIE_CATEGORIES, READ_RULES } = await import("../../shared/dpdp");
  const b = publicBranding(c);
  const notice = await noticeFor(c);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({
    company: { name: b.name, shortName: b.shortName, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl, themeColor: b.themeColor, accentColor: b.accentColor, slug: c.slug },
    notice: { id: String(notice._id), version: notice.version, title: notice.title, html: notice.html, fileName: notice.fileName, hasFile: notice.hasFile, updatedAt: notice.updatedAt },
    purposes: DPDP_PURPOSES,
    cookies: COOKIE_CATEGORIES,
    rules: READ_RULES,
  });
}));

/** The original uploaded notice, for someone who would rather read the PDF. */
r.get("/public/consent/file", h(async (req, res) => {
  const c = await consentCompany(req);
  const doc = await DpdpDocument.findOne({ companyId: c._id, active: true }).sort({ version: -1 }).lean<any>();
  if (!doc?.fileKey) throw new HttpError(404, "This notice has no file");
  const { getObject } = await import("../lib/s3");
  const f = await getObject(doc.fileKey);
  res.setHeader("Content-Type", f.contentType);
  res.setHeader("Content-Disposition", `inline; filename="${(doc.fileName || "notice.pdf").replace(/"/g, "")}"`);
  res.send(f.body);
}));

r.post("/public/consent", h(async (req, res) => {
  const c = await consentCompany(req);
  if (!(await rateLimit(`consent:${requestIp(req)}`, 30, 600))) throw new HttpError(429, "Too many attempts — wait a few minutes");
  const { accept } = await import("../lib/dpdp");
  const b = req.body || {};
  const row = await inCompanyDb(String(c._id), () =>
    accept({
      companyId: c._id,
      documentId: b.documentId,
      documentVersion: Number(b.documentVersion) || undefined,
      subjectKind: ["visitor", "lead", "client", "user"].includes(b.subjectKind) ? b.subjectKind : "visitor",
      visitorId: String(b.visitorId || "").slice(0, 60),
      name: String(b.name || "").slice(0, 120) || undefined,
      email: String(b.email || "").toLowerCase().slice(0, 160) || undefined,
      phone: String(b.phone || "").replace(/\D/g, "").slice(0, 15) || undefined,
      purposes: Array.isArray(b.purposes) ? b.purposes.map((x: any) => String(x).slice(0, 30)) : [],
      source: ["website", "app", "crm", "form"].includes(b.source) ? b.source : "website",
      page: String(b.page || "").slice(0, 300),
      openedAt: b.openedAt ? new Date(b.openedAt) : undefined,
      readSeconds: Math.min(7200, Math.max(0, Number(b.readSeconds) || 0)),
      scrollPct: Math.min(100, Math.max(0, Number(b.scrollPct) || 0)),
      reachedEndAt: b.reachedEndAt ? new Date(b.reachedEndAt) : undefined,
      ip: requestIp(req),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 250),
    })
  ).catch((e: any) => {
    throw new HttpError(400, e.message);
  });
  res.status(201).json({ ok: true, id: String(row._id), acceptedAt: row.acceptedAt });
}));

/** What the visitor chose in the cookie banner. */
r.post("/public/cookies", h(async (req, res) => {
  const c = await consentCompany(req);
  const { cookieChoice } = await import("../lib/dpdp");
  const b = req.body || {};
  const cats = b.categories && typeof b.categories === "object" ? b.categories : {};
  await inCompanyDb(String(c._id), () =>
    cookieChoice(c._id, {
      visitorId: String(b.visitorId || "").slice(0, 60),
      categories: { preferences: !!cats.preferences, analytics: !!cats.analytics, marketing: !!cats.marketing },
      choice: ["all", "necessary", "custom"].includes(b.choice) ? b.choice : "custom",
      page: String(b.page || "").slice(0, 300),
      ip: requestIp(req),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 250),
    })
  );
  res.status(201).json({ ok: true });
}));

/* ───────────────────────── Mobile builds (reported by GitHub Actions) ─────────────────────────
 * The workflow is the only thing that posts here, and it signs every message with MOBILE_BUILD_SECRET.
 * Nothing in the body is trusted beyond the build it names: the company, version and S3 key were decided
 * when the build was started.
 */
r.post("/public/mobile/build", h(async (req: any, res) => {
  const { callbackValid, updateBuild } = await import("../lib/mobilebuild");
  const raw = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body || {});
  if (!(await callbackValid(raw, req.headers["x-build-signature"] as string))) throw new HttpError(401, "Bad signature");
  const b = req.body || {};
  if (!b.build_id) throw new HttpError(400, "build_id is required");
  const status = ["building", "ready", "failed"].includes(b.status) ? b.status : undefined;
  const build = await updateBuild(String(b.build_id), {
    status,
    runId: b.run_id ? String(b.run_id) : undefined,
    runUrl: b.run_url ? String(b.run_url).slice(0, 300) : undefined,
    fileKey: b.file_key ? String(b.file_key).slice(0, 300) : undefined,
    fileName: b.file_name ? String(b.file_name).slice(0, 160) : undefined,
    fileSize: b.file_size ? Number(b.file_size) : undefined,
    sha256: b.sha256 ? String(b.sha256).slice(0, 80) : undefined,
    error: b.error ? String(b.error).slice(0, 600) : undefined,
    // how far along, and the sentence under the bar, reported by whichever step has just finished
    progress: b.progress !== undefined && b.progress !== null ? Number(b.progress) : undefined,
    phase: b.phase ? String(b.phase).slice(0, 120) : undefined,
    // a store build also says what became of it at Google or Apple
    store: b.store_note
      ? {
          uploaded: /^uploaded/i.test(String(b.store_note)),
          track: /TestFlight/i.test(String(b.store_note)) ? "TestFlight" : /internal/i.test(String(b.store_note)) ? "Internal testing" : undefined,
          at: new Date(),
          message: String(b.store_note).slice(0, 300),
        }
      : undefined,
  });
  if (!build) throw new HttpError(404, "Unknown build");

  /**
   * A finished app tells the phones that already have it.
   *
   * Only a build somebody can actually install is announced — a store build is an .aab or an App Store .ipa,
   * which no phone installs directly, so telling people about one would send them to a file that cannot
   * work. Devices already on this version are left alone. The push never fails the callback: a build that
   * finished is still a build.
   */
  if (build.status === "ready" && build.target !== "store") {
    (async () => {
      const { Company } = await import("../models");
      const { pushAppUpdate } = await import("../lib/push");
      const { tenantUrls } = await import("../lib/tenant");
      const c = await Company.findById(build.companyId).select("name slug customDomain mobile").lean<any>();
      if (!c) return;
      const u = tenantUrls(c);
      const base = (u as any).customUrl || (u as any).platformUrl || (process.env.APP_BASE_URL || "");
      await pushAppUpdate(build.companyId, build.platform, build.version, `${base}/app/settings/mobile-app`, c.mobile?.appName || c.name);
    })().catch(() => {});
  }

  res.json({ ok: true, status: build.status });
}));

/**
 * What the newest installable version of a company's app is.
 *
 * The app asks this when it starts and when it comes back to the foreground, and shows a bar offering the
 * update when its own version is behind. Public on purpose — it says a version number and a download page,
 * nothing about anybody — and it answers for a company by its code, which is what the app already knows.
 */
r.get("/public/mobile/latest", h(async (req, res) => {
  const { Company, MobileBuild } = await import("../models");
  const { tenantUrls } = await import("../lib/tenant");
  const code = String(req.query.code || "").trim().toUpperCase();
  const platform = String(req.query.platform || "android") === "ios" ? "ios" : "android";
  if (!code) throw new HttpError(400, "code is required");
  const c = await Company.findOne({ code, deletedAt: null }).select("name slug customDomain mobile").lean<any>();
  if (!c) throw new HttpError(404, "Unknown company");
  const build = await MobileBuild.findOne({ companyId: c._id, platform, status: "ready", target: { $ne: "store" } }).sort({ createdAt: -1 }).select("version fileSize createdAt notes").lean<any>();
  const u = tenantUrls(c);
  const base = (u as any).customUrl || (u as any).platformUrl || (process.env.APP_BASE_URL || "");
  res.json({
    version: build?.version || null,
    size: build?.fileSize || null,
    releasedAt: build?.createdAt || null,
    notes: build?.notes || null,
    url: build ? `${base}/app/settings/mobile-app` : null,
    appName: c.mobile?.appName || c.name,
  });
}));

/**
 * The signing key for one build, collected by the workflow itself.
 *
 * It is not a workflow input because inputs are printed in the run's own log. The build proves it is that
 * build by signing its id with the same shared secret the result callback uses, and the key is only given out
 * while the build is still running — a finished build's id is worth nothing.
 */
r.get("/public/mobile/signing/:buildId", h(async (req, res) => {
  const { callbackValid } = await import("../lib/mobilebuild");
  const { keyForBuild } = await import("../lib/signing");
  const { MobileBuild } = await import("../models");
  const id = String(req.params.buildId);
  if (!(await callbackValid(id, req.headers["x-build-signature"] as string))) throw new HttpError(401, "Bad signature");

  const build = await MobileBuild.findById(id).lean<any>();
  if (!build) throw new HttpError(404, "Unknown build");
  if (!["queued", "building"].includes(build.status)) throw new HttpError(409, "That build is no longer running");
  const key = await keyForBuild(build.companyId);
  if (!key) throw new HttpError(404, "No signing key for this company");

  res.setHeader("Cache-Control", "no-store");
  res.json({ alias: key.alias, keystore_base64: key.keystoreBase64, store_password: key.storePass, key_password: key.keyPass });
}));

/**
 * A push to the app's own repository — every company set to rebuild automatically gets a fresh app.
 *
 * Both routes into this are the same shape: a step in the repository's workflow, or a repository webhook with
 * "Just the push event". Either way the body is signed with the trigger secret, and a push to any branch but
 * the configured one is accepted and ignored, so a feature branch never rebuilds anyone's app.
 */
r.post("/public/webhooks/github/push", h(async (req: any, res) => {
  const { state, pushSignatureValid, saveState, rebuildAll } = await import("../lib/autobuild");
  const cfg = await state();
  const raw = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body || {});
  const header = (req.headers["x-hub-signature-256"] || req.headers["x-build-signature"]) as string | undefined;
  if (!pushSignatureValid(raw, header, cfg.secret)) throw new HttpError(401, "Bad signature");
  if (!cfg.on) return res.json({ ok: true, skipped: "automatic rebuilds are switched off" });

  const b = req.body || {};
  const branch = String(b.ref || "").replace("refs/heads/", "") || String(b.branch || "");
  if (branch && cfg.branch && branch !== cfg.branch) return res.json({ ok: true, skipped: `push to ${branch}, watching ${cfg.branch}` });

  const head = b.head_commit || {};
  const out = await rebuildAll("github-push", "push");
  await saveState({
    lastPush: {
      sha: String(head.id || b.after || "").slice(0, 7),
      message: String(head.message || "").split("\n")[0].slice(0, 160),
      at: new Date(),
      builds: out.builds,
      companies: out.companies,
    },
  });
  res.json({ ok: true, ...out });
}));

/* ───────────────────────── The company website (public) ───────────────────────── */

r.get("/public/site", h(async (req, res) => {
  const c = await consentCompany(req);
  const { startingSite, SITE_SECTIONS } = await import("../../shared/site");
  const site = c.site && Object.keys(c.site?.sections || {}).length ? c.site : startingSite(c);
  if (!site.published && req.query.preview !== "1") throw new HttpError(404, "This website is not published yet");
  const b = publicBranding(c);
  // the enquiry form may offer the company's own service list
  let services: string[] = [];
  if (site.sections?.enquiry?.askService || site.sections?.featured?.fromServices) {
    services = await inCompanyDb(String(c._id), async () => (await ServiceType.find({ companyId: c._id }).select("name").sort({ name: 1 }).limit(50).lean<any[]>()).map((x: any) => x.name)).catch(() => []);
  }
  const { noticeFor } = await import("../lib/dpdp");
  const notice = site.sections?.policies?.showConsentLink !== false ? await noticeFor(c).catch(() => null) : null;
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
  res.json({
    company: { name: b.name, shortName: b.shortName, tagline: b.tagline, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl, themeColor: b.themeColor, accentColor: b.accentColor, slug: c.slug },
    site: { published: site.published, sections: site.sections },
    sections: SITE_SECTIONS,
    services,
    consent: notice ? { version: notice.version, title: notice.title } : null,
  });
}));

/** The website's enquiry form. Creates a lead through the same path every other channel uses. */
r.post("/public/site/enquiry", h(async (req, res) => {
  const c = await consentCompany(req);
  const ip = requestIp(req);
  if (!(await rateLimit(`site-enquiry:${ip}`, 10, 600))) throw new HttpError(429, "Too many enquiries from here — please try again in a few minutes");
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 120);
  const phone = String(b.phone || "").replace(/\D/g, "").slice(0, 15);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 160);
  if (!name) throw new HttpError(400, "Please give your name");
  if (!phone && !email) throw new HttpError(400, "Please give a phone number or an e-mail address");
  if (String(b.website || "")) return res.status(201).json({ ok: true }); // honeypot: a bot filled the hidden field
  const site = c.site || {};
  const campaign = String(site.sections?.enquiry?.campaign || "website").slice(0, 60);

  const { upsertLead } = await import("../lib/intake");
  const lead = await inCompanyDb(String(c._id), () =>
    upsertLead(String(c._id), {
      name,
      phone: phone || undefined,
      whatsapp: phone || undefined,
      email: email || undefined,
      companyName: String(b.companyName || "").slice(0, 150) || undefined,
      source: "website_form",
      campaign,
      medium: "website",
      serviceLines: b.service ? [{ serviceType: String(b.service).slice(0, 80), licenses: 1 }] : undefined,
      comments: String(b.message || "").slice(0, 2000) || undefined,
      consentWhatsapp: !!b.consent,
    } as any, { by: "website" })
  );

  // the consent ticked on the form is recorded as its own DPDP record, with the notice version it referred to
  if (b.consent) {
    const { noticeFor, accept } = await import("../lib/dpdp");
    const notice = await noticeFor(c).catch(() => null);
    if (notice)
      await inCompanyDb(String(c._id), () =>
        accept({
          companyId: c._id,
          documentId: notice._id,
          documentVersion: notice.version,
          subjectKind: "lead",
          subjectId: String((lead as any)?.lead?._id || ""),
          visitorId: String(b.visitorId || "").slice(0, 60),
          name,
          email: email || undefined,
          phone: phone || undefined,
          purposes: Array.isArray(b.purposes) && b.purposes.length ? b.purposes.map((x: any) => String(x)) : ["contact", "service", "records"],
          source: "form",
          page: String(b.page || "").slice(0, 300),
          readSeconds: Number(b.readSeconds) || 6,
          scrollPct: Number(b.scrollPct) || 100,
          reachedEndAt: new Date(),
          ip,
          userAgent: String(req.headers["user-agent"] || "").slice(0, 250),
        })
      ).catch(() => undefined); // the lead is saved whatever happens to the consent row
  }
  res.status(201).json({ ok: true, thanks: site.sections?.enquiry?.thanks || "Thank you — we will be in touch shortly." });
}));

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
/** Privacy / terms / data-deletion pages: who to contact (editable in Super Admin › Platform Apps). */
r.get("/public/privacy", h(async (req, res) => {
  await loadPlatformBranding();
  const c = await getCompliance();
  const b: any = platformBranding();
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.json({ ...c, product: b.name || "CredoOne", consentVersion: CONSENT_VERSION, platformUrl: platformUrl(req) });
}));

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

/** Streams a company's logo / banner / favicon, or its app logo / app banner, from the private S3 bucket. */
r.get("/public/brand-asset/:companyId/:kind", h(async (req, res) => {
  const kind = req.params.kind;
  if (![...BRAND_ASSET_KINDS].includes(kind as any)) throw new HttpError(404, "Not found");
  const c = await Company.findOne({ _id: req.params.companyId, deletedAt: null }).select("branding").lean<any>();
  const key = c?.branding?.[`${kind}Key`];
  if (!key) throw new HttpError(404, "Not found");
  const obj = await getObject(key);
  res.setHeader("Content-Type", obj.contentType);
  res.setHeader("Cache-Control", "public, max-age=86400, immutable"); // URL carries ?v=<updatedAt>
  res.send(obj.body);
}));

/**
 * How a company's app should look before anyone signs in.
 *
 * The app knows its own company code because the build put it there, and asks for this once on launch. It
 * caches what comes back, so this is never on the path between opening the app and seeing the sign-in
 * screen — the screen draws from the cache immediately and this refreshes it behind that.
 *
 * Public on purpose: it is the screen shown to someone who has not signed in yet. It carries a name, two
 * colours, some wording and two image addresses, and nothing else — no counts, no people, no settings.
 */
r.get("/public/app-brand", h(async (req, res) => {
  const code = String(req.query.code || "").trim().toUpperCase();
  if (!code) throw new HttpError(400, "Pass the company code");
  const c = await Company.findOne({ code, deletedAt: null }).select("name code branding whiteLabel status").lean<any>();
  if (!c) throw new HttpError(404, "No company with that code");
  const v = c.branding?.updatedAt ? new Date(c.branding.updatedAt).getTime() : 0;
  const asset = (kind: string, key?: string) => (key ? `/api/public/brand-asset/${c._id}/${kind}?v=${v}` : undefined);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(mobileBrand(c, asset));
}));

/** Public info for the hosted QR / campaign form page. */
r.get("/forms/:key", h(async (req, res) => {
  const c = await loadConnector(req.params.key);
  if (!["qr_campaign", "website_form"].includes(c.type)) throw new HttpError(404, "Not a form connector");
  const company = await Company.findById(c.companyId).lean<any>();
  const brand = company ? publicBranding(company) : null;
  res.json({
    title: c.name,
    company: brand?.shortName || company?.name,
    campaign: c.defaultCampaign,
    logoUrl: brand?.logoUrl,
    themeColor: brand?.themeColor,
    accentColor: brand?.accentColor,
    /* a connector with nothing saved gets the original four fields and the original wording back */
    form: normaliseForm(c.config?.form),
  });
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
/** Hourly: queue scheduled "AI insights" WhatsApp digests (they run on the job worker). */
r.get("/cron/insights", h(async (req, res) => {
  cronAuth(req);
  const { scheduleInsights } = await import("../lib/insights");
  res.json({ queued: await runPlatform("insights", () => scheduleInsights(), { force: true }) });
}));

/** Every minute: background job worker (imports, exports, WhatsApp redelivery, scheduled AI digests). */
r.get("/cron/jobs", h(async (req, res) => {
  cronAuth(req);
  const ran = await runPlatform("jobs", () => pump({ budgetMs: 50_000 }), { force: true });
  res.json({ ran });
}));

r.get("/cron/retry", h(async (req, res) => {
  cronAuth(req);
  let retried = 0;
  let ok = 0;
  let skipped = 0;
  // Each company's own schedule (Super Admin › Company › Cron Jobs) decides whether its share runs on this beat.
  for (const co of await activeCompanies()) {
    const out = await runFor("retry", co, async () => {
      const r2: any = await runJobForCompany("retry", co);
      retried += r2.retried || 0;
      ok += r2.ok || 0;
      return r2;
    }).catch(() => null);
    if (out === null) skipped++;
  }
  const moved = await sweepStragglers().catch(() => 0);
  res.json({ retried, ok, skipped, moved });
}));

/** Daily 01:00 IST: delete log records older than each company's Retention Policy. */
r.get("/cron/housekeeping", h(async (req, res) => {
  cronAuth(req);
  const out: Record<string, any> = {};
  for (const co of await activeCompanies()) {
    const r2 = await runFor("housekeeping", co, () => runJobForCompany("housekeeping", co)).catch((e) => ({ error: e.message }));
    if (r2) out[co.code] = (r2 as any).total ?? r2;
  }
  res.json({ companies: Object.keys(out).length, removed: out });
}));

/** Daily 02:00 IST: MCP server connectors. */
r.get("/cron/pull", h(async (req, res) => {
  cronAuth(req);
  res.json(await runPlatform("pull", () => runPullConnectors("daily"), { force: true }));
}));

/** Every 15 minutes: Public Web Prospecting — seeds each connector daily from 02:00 IST, then reads its queue in time-boxed slices. */
r.get("/cron/prospect", h(async (req, res) => {
  cronAuth(req);
  res.json(await runPlatform("prospect", () => prospectWorker(), { force: true }));
}));

/** Every 15 minutes: IndiaMART Pull API, TradeIndia My Inquiry API, WooCommerce REST safety net. */
r.get("/cron/pull-frequent", h(async (req, res) => {
  cronAuth(req);
  res.json(await runPlatform("pull_frequent", () => runPullConnectors("frequent"), { force: true }));
}));

/** Daily 02:00 IST: AI allocation renewals, subscription cycles, Unpaid → Over Due → Expired, 1/3/7-day reminders. */
r.get("/cron/billing", h(async (req, res) => {
  cronAuth(req);
  const platform = await runBillingJobs();
  // Client module: generate this period's recurring dues and mark unpaid past-due ones Over-Due, company by company,
  // each one on the schedule set for it in Super Admin › Company › Cron Jobs.
  let ran = 0;
  let skipped = 0;
  for (const co of await activeCompanies()) {
    const out = await runFor("billing", co, () => runJobForCompany("billing", co)).catch(() => null);
    out === null ? skipped++ : ran++;
  }
  res.json({ ...platform, clientBilling: { companies: ran, skipped } });
}));

/** Daily 08:00 IST: follow-up digest per company (event: followup_digest). */
r.get("/cron/followups", h(async (req, res) => {
  cronAuth(req);
  let sent = 0;
  let companies = 0;
  let skipped = 0;
  for (const co of await activeCompanies()) {
    const out: any = await runFor("followups", co, () => runJobForCompany("followups", co)).catch(() => null);
    if (out === null) skipped++;
    else {
      companies++;
      sent += out?.sent || 0;
    }
  }
  res.json({ companies, sent, skipped });
}));

export default r;

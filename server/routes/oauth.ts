/**
 * Public sign-in + platform webhook endpoints (no CredoOne session: the state value or the platform's signature
 * is what authenticates each call).
 *
 *   GET  /api/oauth/:provider/start?state=…    → 302 to the platform's own login page
 *   GET  /api/oauth/:provider/callback          ← platform returns here (registered once in each Platform App)
 *   GET  /api/oauth/meta/webhook                ← Meta verify handshake (hub.challenge)
 *   POST /api/oauth/meta/webhook                ← Page "leadgen" events, signed with the app secret
 *   GET  /api/oauth/linkedin/webhook            ← LinkedIn challengeCode validation
 *   POST /api/oauth/linkedin/webhook            ← lead notifications, signed with the client secret
 */
import { Router } from "express";
import { OAuthState, SsoRoute, Connector } from "../models";
import { h, HttpError } from "../lib/http";
import { encrypt, decrypt } from "../lib/crypto";
import { runInDb } from "../lib/context";
import { rateLimit } from "../lib/cache";
import { getApp, authorizeUrl, callbackUrl, exchangeCode, readState, metaSignatureOk, metaLead, metaLeadIsFor, ingestMetaLead, liChallenge, liSignatureOk, runSso, REQUIRED_META } from "../lib/oauth";
import { processIntake } from "../lib/intake";
import { SSO_INFO, isSsoType, type SsoProvider } from "../../shared/sso";

const r = Router();
const PROVIDERS: SsoProvider[] = ["meta", "linkedin", "google"];
const done = (q: Record<string, string>) => `/oauth/done?${new URLSearchParams(q)}`;

r.get("/:provider/start", h(async (req, res) => {
  const provider = req.params.provider as SsoProvider;
  if (!PROVIDERS.includes(provider)) throw new HttpError(404, "Unknown platform");
  let s: any;
  try {
    s = await readState(String(req.query.state || ""));
  } catch (e: any) {
    return res.redirect(303, done({ error: e.message }));
  }
  if (s.provider !== provider || s.status !== "pending" || !isSsoType(s.type)) return res.redirect(303, done({ error: "This sign-in link was already used — click Connect again", state: s._id }));
  const app = await getApp(provider);
  if (!app) return res.redirect(303, done({ error: `${SSO_INFO[s.type as keyof typeof SSO_INFO].platform} sign-in isn't enabled yet — ask your platform administrator`, state: s._id }));
  res.redirect(302, authorizeUrl(provider, s.type, app, s._id, callbackUrl(provider, req), !!s.connectorId));
}));

r.get("/:provider/callback", h(async (req, res) => {
  const provider = req.params.provider as SsoProvider;
  if (!PROVIDERS.includes(provider)) throw new HttpError(404, "Unknown platform");
  const stateId = String(req.query.state || "");
  let s: any;
  try {
    s = await readState(stateId);
  } catch (e: any) {
    return res.redirect(303, done({ error: e.message }));
  }
  const fail = async (msg: string) => {
    await OAuthState.updateOne({ _id: s._id }, { $set: { status: "failed", error: msg } });
    return res.redirect(303, done({ error: msg, state: s._id }));
  };
  if (s.provider !== provider || s.status !== "pending") return fail("This sign-in was already completed — close this window");
  if (req.query.error) {
    const why = String(req.query.error_description || req.query.error_reason || req.query.error);
    return fail(/denied|cancel/i.test(why) ? "Sign-in was cancelled — nothing was connected" : `The platform refused the sign-in: ${why}`);
  }
  const app = await getApp(provider);
  if (!app) return fail("This platform isn't enabled any more");
  try {
    const t = await exchangeCode(provider, app, String(req.query.code || ""), callbackUrl(provider, req));
    if (provider === "meta") {
      const missing = REQUIRED_META.filter((p) => !t.scopes.includes(p));
      if (missing.length) return fail(`Connected without a permission we need (${missing.join(", ")}). Click Connect again and keep every box ticked on Facebook's screen.`);
    }
    await OAuthState.updateOne({ _id: s._id }, { $set: { status: "authorized", tokenEnc: encrypt(t.token), refreshEnc: encrypt(t.refresh), expiresAt: t.expiresAt, scopes: t.scopes, account: t.account } });
  } catch (e: any) {
    return fail(e.message || "Sign-in failed");
  }
  res.redirect(303, done({ ok: "1", state: s._id }));
}));

/* ───────────── Meta: Page leadgen webhook (one for the whole platform app) ───────────── */

r.get("/meta/webhook", h(async (req, res) => {
  const app = await getApp("meta");
  if (req.query["hub.mode"] === "subscribe" && app?.verifyToken && req.query["hub.verify_token"] === app.verifyToken) return res.status(200).type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
  throw new HttpError(403, "Verify token mismatch — copy it from Super Admin › Platform Apps › Meta");
}));

r.post("/meta/webhook", h(async (req: any, res) => {
  const app = await getApp("meta");
  if (!app || !metaSignatureOk(app.clientSecret, req.rawBody || "", req.headers["x-hub-signature-256"] as string)) throw new HttpError(401, "Invalid signature");
  const results: any[] = [];
  for (const entry of req.body?.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== "leadgen") continue;
      const v = ch.value || {};
      const pageId = String(v.page_id || entry.id || "");
      const routes = await SsoRoute.find({ provider: "meta", externalId: pageId }).lean<any[]>();
      if (!routes.length) {
        results.push({ page: pageId, ignored: "no connector" });
        continue;
      }
      let lead: any = null; // fetched once per Page, shared by its Facebook and Instagram connectors
      const types = new Set(routes.map((x) => x.type));
      for (const route of routes) {
        await runInDb(route.db, async () => {
          const c = await Connector.findOne({ key: route.connectorKey, active: true }).lean<any>();
          if (!c) return;
          const page = (c.sso?.pages || []).find((p: any) => p.id === pageId);
          const token = decrypt(page?.tokenEnc);
          try {
            if (!lead && token) lead = await metaLead(String(v.leadgen_id), token);
          } catch {}
          if (lead) {
            const other = c.type === "facebook_leads" ? "instagram_leads" : "facebook_leads";
            if (metaLeadIsFor(c.type, lead, types.has(other))) results.push(await ingestMetaLead(c, page, lead));
          } else if (route === routes[0]) {
            // couldn't fetch now (token or Graph hiccup): stored and retried by the delivery queue
            results.push(await processIntake(c, { meta_pending: { leadgen_id: String(v.leadgen_id), page_id: pageId } }, `fb:${v.leadgen_id}`).catch((e) => ({ error: e.message })));
          }
        });
      }
    }
  }
  res.status(200).json({ received: true, results: results.length });
}));

/* ───────────── LinkedIn: lead notifications ───────────── */

r.get("/linkedin/webhook", h(async (req, res) => {
  const app = await getApp("linkedin");
  const code = String(req.query.challengeCode || "");
  if (!app || !code) throw new HttpError(400, "Missing challengeCode");
  res.json({ challengeCode: code, challengeResponse: liChallenge(app.clientSecret, code) });
}));

r.post("/linkedin/webhook", h(async (req: any, res) => {
  const app = await getApp("linkedin");
  if (!app || !liSignatureOk(app.clientSecret, req.rawBody || "", req.headers["x-li-signature"] as string)) throw new HttpError(401, "Invalid signature");
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const owners = new Set<string>();
  for (const e of events) {
    if (e?.leadAction && e.leadAction !== "CREATED") continue;
    const o = e?.owner?.sponsoredAccount || e?.owner?.organization;
    if (o) owners.add(String(o));
  }
  let ran = 0;
  for (const o of owners) {
    for (const route of await SsoRoute.find({ provider: "linkedin", externalId: o }).lean<any[]>()) {
      if (!(await rateLimit(`li-wh:${route.connectorKey}`, 20, 60))) continue;
      await runInDb(route.db, async () => {
        const c = await Connector.findOne({ key: route.connectorKey, active: true }).lean<any>();
        if (c) {
          await runSso(c); // fetches the new responses (deduplicated by response id)
          ran++;
        }
      });
    }
  }
  res.status(200).json({ received: true, connectors: ran });
}));

export default r;

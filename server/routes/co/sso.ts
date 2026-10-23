/**
 * Company › Integration › sign-in connectors (Facebook Lead Ads, Instagram Lead Ads, LinkedIn Lead Gen Forms, Google Sheets).
 * See server/lib/oauth.ts for the whole flow. Companies never handle App IDs, secrets or tokens.
 */
import { Router } from "express";
import { z } from "zod";
import { Connector, ConnectorKey, OAuthState } from "../../models";
import { can, tenant } from "../../middleware/auth";
import { h, parse, notFound, badRequest, forbidden, HttpError } from "../../lib/http";
import { encrypt, decrypt, randomKey } from "../../lib/crypto";
import { currentDb } from "../../lib/context";
import { invalidate, rateLimit } from "../../lib/cache";
import { getApp, getCompliance, platformUrl, newState, readState, listChoices, metaPagesFor, linkedinSubscribe, setRoutes, sheetIdOf, sheetInfo, sheetRowCount, disconnect, runSso } from "../../lib/oauth";
import { SSO_TYPES, SSO_INFO, CONSENT_VERSION, isSsoType, type SsoType } from "../../../shared/sso";
import { CONNECTOR_TYPES } from "../../../shared/constants";

const r = Router();
const ipOf = (req: any) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

/** Which sign-ins are switched on (Super Admin › Platform Apps) + the consent notice details. */
r.get("/sso/providers", can("integrations", "read"), h(async (req, res) => {
  const [meta, linkedin, google, privacy] = await Promise.all([getApp("meta"), getApp("linkedin"), getApp("google"), getCompliance()]);
  res.json({
    enabled: { meta: !!meta, linkedin: !!linkedin, google: !!google },
    consentVersion: CONSENT_VERSION,
    privacy: { email: privacy.email, officer: privacy.officer, legalName: privacy.legalName },
    privacyUrl: `${platformUrl(req)}/privacy`,
  });
}));

/** Step 1 — consent given → a one-time sign-in link for the popup. */
r.post("/sso/start", can("integrations", "create"), h(async (req, res) => {
  const b = parse(z.object({ type: z.enum(SSO_TYPES as [SsoType, ...SsoType[]]), accepted: z.array(z.string().max(40)).max(10), all: z.boolean().optional(), connectorId: z.string().regex(/^[a-f0-9]{24}$/).optional() }), req.body);
  const info = SSO_INFO[b.type];
  const missing = info.purposes.filter((p) => !b.accepted.includes(p.key));
  if (missing.length) throw badRequest(`Please agree to: ${missing.map((m) => m.label).join("; ")} — they are needed to receive leads`);
  if (!(await getApp(info.provider))) throw new HttpError(409, `${info.platform} sign-in isn't enabled yet — ask your platform administrator (Super Admin › Platform Apps)`);
  if (b.connectorId && !(await Connector.exists({ _id: b.connectorId, type: b.type, ...tenant(req) }))) throw notFound("Connector not found");
  if (!(await rateLimit(`sso:${req.auth!.userId}`, 20, 600))) throw new HttpError(429, "Too many sign-in attempts — wait a few minutes");
  const id = newState();
  await OAuthState.create({
    _id: id,
    provider: info.provider,
    type: b.type,
    companyId: req.auth!.companyId,
    db: currentDb(),
    userId: req.auth!.userId,
    userName: `${req.auth!.name} <${req.auth!.email}>`,
    connectorId: b.connectorId,
    consent: { version: CONSENT_VERSION, purposes: info.purposes.map((p) => p.key), all: !!b.all, by: `${req.auth!.name} <${req.auth!.email}>`, at: new Date(), ip: ipOf(req), userAgent: String(req.headers["user-agent"] || "").slice(0, 200) },
  });
  res.locals.action = "Consent given";
  res.locals.item = `${info.platform} — ${CONSENT_VERSION}`;
  res.json({ state: id, url: `${platformUrl(req)}/api/oauth/${info.provider}/start?state=${id}` });
}));

async function myState(req: any) {
  const s = await readState(req.params.state);
  if (String(s.companyId) !== String(req.auth!.companyId) || String(s.userId) !== String(req.auth!.userId)) throw forbidden("This sign-in belongs to someone else");
  return s;
}

/** Step 2 — polled by the Connect window: signed in yet? then what can be picked. */
r.get("/sso/state/:state", can("integrations", "read"), h(async (req, res) => {
  const s = await myState(req);
  if (s.status !== "authorized") return res.json({ status: s.status, error: s.error, type: s.type });
  const choices = await listChoices(s.type, decrypt(s.tokenEnc)).catch((e) => ({ kind: "error", items: [], note: e.message }));
  res.json({ status: s.status, type: s.type, account: s.account, choices, reconnect: !!s.connectorId });
}));

/** Google Sheets: tabs of the pasted sheet (checks the signed-in account can open it). */
r.post("/sso/state/:state/sheet", can("integrations", "create"), h(async (req, res) => {
  const s = await myState(req);
  if (s.status !== "authorized" || s.type !== "google_sheets") throw badRequest("Sign in with Google first");
  const id = sheetIdOf(parse(z.object({ url: z.string().min(10).max(500) }), req.body).url);
  if (!id) throw badRequest("Paste the sheet's link (docs.google.com/spreadsheets/d/…)");
  res.json({ id, ...(await sheetInfo(decrypt(s.tokenEnc), id)) });
}));

const finishBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  selected: z.array(z.string().max(120)).max(50).default([]),
  sheetUrl: z.string().max(500).optional(),
  tab: z.string().max(120).optional(),
  importExisting: z.boolean().default(false),
  defaultCampaign: z.string().max(120).optional(),
  defaultMedium: z.string().max(60).optional(),
});

/** Step 3 — create (or reconnect) the connector with what was picked. */
r.post("/sso/state/:state/finish", can("integrations", "create"), h(async (req, res) => {
  const s = await myState(req);
  if (s.status !== "authorized") throw badRequest(s.status === "used" ? "Already connected — close this window" : "Sign in on the platform first");
  const b = parse(finishBody, req.body);
  const selected = b.selected || [];
  const type = s.type as SsoType;
  const info = SSO_INFO[type];
  const token = decrypt(s.tokenEnc);
  const sso: any = {};
  let routeIds: string[] = [];

  if (type === "facebook_leads" || type === "instagram_leads") {
    const { items } = await listChoices(type, token);
    const ok = selected.filter((id) => items.some((i) => i.id === id && !i.disabled));
    if (!ok.length) throw badRequest(`Pick at least one ${type === "facebook_leads" ? "Page" : "Instagram account"}`);
    sso.pages = await metaPagesFor(type, token, ok);
    routeIds = sso.pages.map((p: any) => p.id);
  } else if (type === "linkedin_leads") {
    const { items } = await listChoices(type, token);
    const picked = items.filter((i) => selected.includes(i.id));
    if (!picked.length) throw badRequest("Pick at least one ad account or Page");
    sso.adAccounts = picked.filter((i) => i.id.includes(":sponsoredAccount:")).map((i) => ({ id: i.id, name: i.name }));
    sso.organizations = picked.filter((i) => i.id.includes(":organization:")).map((i) => ({ id: i.id, name: i.name }));
    sso.notifications = await linkedinSubscribe(token, picked, req);
    routeIds = picked.map((i) => i.id);
  } else {
    const id = sheetIdOf(b.sheetUrl || "");
    if (!id) throw badRequest("Paste the sheet's link");
    const meta = await sheetInfo(token, id);
    const tab = b.tab && meta.tabs.includes(b.tab) ? b.tab : meta.tabs[0];
    if (!tab) throw badRequest("That sheet has no tabs");
    sso.sheet = { id, title: meta.title, tab, row: b.importExisting ? 1 : await sheetRowCount(token, id, tab) };
  }

  const oauth = { provider: info.provider, account: s.account, tokenEnc: s.tokenEnc, refreshEnc: s.refreshEnc, expiresAt: s.expiresAt, scopes: s.scopes, status: "connected", error: null, connectedAt: new Date(), connectedBy: s.userName };
  const consent = { ...s.consent, connectedAt: new Date() };
  let c: any;
  if (s.connectorId) {
    c = await Connector.findOneAndUpdate({ _id: s.connectorId, type, ...tenant(req) }, { $set: { oauth, sso, consent, active: true, lastRun: null, ...(b.name ? { name: b.name } : {}) } }, { new: true }).lean<any>();
    if (!c) throw notFound("Connector not found");
    await ConnectorKey.updateOne({ key: c.key }, { $set: { active: true } });
  } else {
    const label = CONNECTOR_TYPES.find((t) => t.type === type)?.label || info.platform;
    const what = sso.pages?.map((p: any) => (type === "instagram_leads" && p.ig ? `@${p.ig.username}` : p.name)).join(", ") || [...(sso.adAccounts || []), ...(sso.organizations || [])].map((a: any) => a.name).join(", ") || sso.sheet?.title;
    c = (
      await Connector.create({
        ...tenant(req),
        type,
        name: b.name || `${label}${what ? ` — ${what}` : ""}`.slice(0, 100),
        key: `${type.slice(0, 3)}_${randomKey(10)}`,
        secretEnc: encrypt(randomKey(24)),
        defaultCampaign: b.defaultCampaign,
        defaultMedium: b.defaultMedium,
        defaultSource: type === "google_sheets" ? "google_sheets" : info.platform.toLowerCase(),
        oauth,
        sso,
        consent,
      })
    ).toObject();
    await ConnectorKey.create({ key: c.key, companyId: c.companyId, db: currentDb(), type, active: true });
  }
  if (info.provider !== "google") await setRoutes(info.provider as "meta" | "linkedin", c, routeIds);
  await OAuthState.updateOne({ _id: s._id }, { $set: { status: "used" }, $unset: { tokenEnc: 1, refreshEnc: 1 } });
  await invalidate(`conn:${c.key}`);
  const first = await runSso(c).catch((e) => ({ ok: false, error: e.message })); // first fetch (recent leads / the sheet's rows)
  await Connector.updateOne({ _id: c._id }, { $set: { lastRunAt: new Date(), lastRun: first } });
  res.locals.action = s.connectorId ? "Reconnect" : "Connect";
  res.locals.item = c.name;
  res.status(s.connectorId ? 200 : 201).json({ id: c._id, name: c.name, firstRun: first, pages: (sso.pages || []).map((p: any) => ({ name: p.name, subscribed: p.subscribed, error: p.error })) });
}));

/** Disconnect = withdraw consent: Pages unsubscribed, tokens deleted at once, no more leads. */
r.post("/integrations/:id/disconnect", can("integrations", "update"), h(async (req, res) => {
  const c = await Connector.findOne({ _id: req.params.id, ...tenant(req) }).lean<any>();
  if (!c) throw notFound();
  if (!isSsoType(c.type)) throw badRequest("Only sign-in connectors can be disconnected — switch others off instead");
  await disconnect(c, `${req.auth!.name} <${req.auth!.email}>`);
  await invalidate(`conn:${c.key}`);
  res.locals.action = "Disconnect (consent withdrawn)";
  res.locals.item = c.name;
  res.json({ ok: true });
}));

export default r;

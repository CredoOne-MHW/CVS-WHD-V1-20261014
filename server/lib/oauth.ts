/**
 * Sign-in (SSO) connectors: Facebook Lead Ads, Instagram Lead Ads, LinkedIn Lead Gen Forms, Google Sheets.
 *
 * Super Admin enters Credovation's Platform Apps once (Meta, LinkedIn, Google — stored encrypted in PlatformSetting).
 * A company only clicks Connect: consent notice → platform login page in a popup → pick Pages / accounts / a sheet.
 *
 *  Connect ─▶ POST /api/co/sso/start            (consent recorded, OAuthState created)
 *          ─▶ GET  /api/oauth/:provider/start    (302 to facebook.com / linkedin.com / accounts.google.com)
 *          ─▶ GET  /api/oauth/:provider/callback (code → token, kept encrypted in OAuthState)
 *          ─▶ GET  /api/co/sso/:state            (Pages / accounts to choose from)
 *          ─▶ POST /api/co/sso/:state/finish     (connector created, Pages subscribed to lead webhooks)
 *
 * Leads arrive by platform webhook (Meta leadgen, LinkedIn lead notifications) and, as a safety net, by a pull every
 * 15 minutes, so nothing is lost while a webhook is not set up yet. Google Sheets is pull-only.
 */
import crypto from "crypto";
import type { Request } from "express";
import { PlatformSetting, OAuthState, SsoRoute, Connector, ConnectorKey } from "../models";
import { encrypt, decrypt, sha256, maskSecret, randomKey } from "./crypto";
import { cached, invalidate } from "./cache";
import { HttpError, badRequest } from "./http";
import { configuredBases } from "./tenant";
import { currentDb } from "./context";
import { processIntake } from "./intake";
import { SSO_INFO, DEFAULT_PRIVACY_EMAIL, PROVIDER_INFO, type SsoProvider, type SsoType } from "../../shared/sso";

/* ───────────────────────── endpoints ───────────────────────── */

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
export const LINKEDIN_VERSION = process.env.LINKEDIN_VERSION || "202510";

/** Tests point every platform call at a local stand-in server: https://graph.facebook.com/x → $OAUTH_MOCK_BASE/graph.facebook.com/x */
export const u = (url: string) => (process.env.OAUTH_MOCK_BASE ? url.replace(/^https:\/\//, `${process.env.OAUTH_MOCK_BASE.replace(/\/$/, "")}/`) : url);
const GRAPH = () => u(`https://graph.facebook.com/${GRAPH_VERSION}`);
const LI_API = () => u("https://api.linkedin.com/rest");

/** Where platforms send people back. One fixed address per environment, registered once in each Platform App. */
export function platformUrl(req?: Request): string {
  if (process.env.PLATFORM_URL) return process.env.PLATFORM_URL.replace(/\/$/, "");
  const host = req ? String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "") : "";
  const bases = configuredBases();
  const base = bases.find((b) => host === b || host.endsWith(`.${b}`)) || bases[0];
  if (base) return `https://${base}`;
  return req ? `${req.headers["x-forwarded-proto"] || req.protocol}://${req.headers.host}` : "";
}
export const callbackUrl = (provider: SsoProvider, req?: Request) => `${platformUrl(req)}/api/oauth/${provider}/callback`;
export const webhookUrl = (provider: "meta" | "linkedin", req?: Request) => `${platformUrl(req)}/api/oauth/${provider}/webhook`;

/* ───────────────────────── Platform Apps (Super Admin) ───────────────────────── */

export interface PlatformApp {
  clientId: string;
  clientSecret: string;
  verifyToken?: string; // Meta webhook verify token (generated)
  pagesApp?: boolean; // LinkedIn: app has Lead Sync API approved
  updatedAt?: Date;
  updatedBy?: string;
}

export async function getApp(provider: SsoProvider): Promise<PlatformApp | null> {
  return cached(`papp:${provider}`, 30, async () => {
    const d = await PlatformSetting.findById(`app:${provider}`).lean<any>();
    const v = d?.value;
    if (!v?.clientId || !v?.secretEnc) return null;
    return { clientId: v.clientId, clientSecret: decrypt(v.secretEnc), verifyToken: v.verifyToken, updatedAt: v.updatedAt, updatedBy: v.updatedBy };
  });
}

/** What the Super Admin sees: never the secret. */
export async function appSummary(provider: SsoProvider, req?: Request) {
  const d = await PlatformSetting.findById(`app:${provider}`).lean<any>();
  const v = d?.value || {};
  return {
    provider,
    ...PROVIDER_INFO[provider],
    configured: !!(v.clientId && v.secretEnc),
    clientId: v.clientId || "",
    secretMasked: v.secretEnc ? maskSecret(decrypt(v.secretEnc)) : "",
    verifyToken: provider === "meta" ? v.verifyToken || "" : undefined,
    updatedAt: v.updatedAt,
    updatedBy: v.updatedBy,
    lastTest: v.lastTest,
    callbacks: provider === "google" ? [callbackUrl("google", req)] : [callbackUrl(provider, req)],
    webhook: provider === "google" ? undefined : webhookUrl(provider, req),
  };
}

export async function saveApp(provider: SsoProvider, b: { clientId: string; clientSecret?: string }, by: string) {
  const cur = (await PlatformSetting.findById(`app:${provider}`).lean<any>())?.value || {};
  if (!b.clientSecret && !cur.secretEnc) throw badRequest(`${PROVIDER_INFO[provider].secretLabel} is required`);
  const value = {
    ...cur,
    clientId: b.clientId.trim(),
    secretEnc: b.clientSecret ? encrypt(b.clientSecret.trim()) : cur.secretEnc,
    verifyToken: provider === "meta" ? cur.verifyToken || `credoone-${randomKey(12)}` : undefined,
    updatedAt: new Date(),
    updatedBy: by,
    lastTest: b.clientId.trim() !== cur.clientId || b.clientSecret ? undefined : cur.lastTest,
  };
  await PlatformSetting.updateOne({ _id: `app:${provider}` }, { $set: { value } }, { upsert: true });
  await invalidate(`papp:${provider}`);
}

export async function removeApp(provider: SsoProvider) {
  await PlatformSetting.deleteOne({ _id: `app:${provider}` });
  await invalidate(`papp:${provider}`);
}

/* ───────────────────────── privacy contact (consent notice, /privacy) ───────────────────────── */

export interface Compliance {
  email: string;
  officer: string;
  legalName: string;
  address: string;
  updatedAt?: Date;
}
export async function getCompliance(): Promise<Compliance> {
  return cached("compliance", 60, async () => {
    const v = (await PlatformSetting.findById("compliance").lean<any>())?.value || {};
    return {
      email: v.email || DEFAULT_PRIVACY_EMAIL,
      officer: v.officer || "Grievance Officer",
      legalName: v.legalName || "Credovation Solutions Private Limited",
      address: v.address || "Kolkata, West Bengal, India",
      updatedAt: v.updatedAt,
    };
  });
}
export async function saveCompliance(v: Omit<Compliance, "updatedAt">) {
  await PlatformSetting.updateOne({ _id: "compliance" }, { $set: { value: { ...v, updatedAt: new Date() } } }, { upsert: true });
  await invalidate("compliance");
}

/* ───────────────────────── HTTP helpers ───────────────────────── */

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: r.status, json };
}
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const formHeaders = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };

/** A platform said the login is no longer valid → the connector shows "Reconnect". */
export class LoginExpired extends HttpError {
  constructor(m: string) {
    super(409, m);
  }
}

/* ───────────────────────── Meta (Facebook & Instagram) ───────────────────────── */

const META_SCOPES: Record<string, string[]> = {
  facebook_leads: ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval", "ads_management", "business_management"],
  instagram_leads: ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval", "ads_management", "business_management", "instagram_basic"],
};
export const REQUIRED_META = ["pages_show_list", "pages_manage_metadata", "leads_retrieval"];
const LEAD_FIELDS = "id,created_time,field_data,platform,campaign_name,ad_name,adset_name,form_id,ad_id,is_organic";

async function graph(path: string, token: string, init: RequestInit & { query?: Record<string, string> } = {}) {
  const q = new URLSearchParams({ ...(init.query || {}), access_token: token });
  const { status, json } = await getJson(`${GRAPH()}/${path.replace(/^\//, "")}${path.includes("?") ? "&" : "?"}${q}`, init);
  if (json?.error) {
    const e = json.error;
    if (e.code === 190 || e.code === 102 || e.error_subcode === 463 || e.error_subcode === 460) throw new LoginExpired(`Facebook login has expired or was revoked (${e.message}). Reconnect this connector.`);
    throw new HttpError(status >= 500 ? 502 : 400, `Facebook: ${e.message || "request failed"}`);
  }
  return json;
}

export const metaPageSubscribe = (pageId: string, pageToken: string) => graph(`${pageId}/subscribed_apps`, pageToken, { method: "POST", query: { subscribed_fields: "leadgen" } });
export const metaPageUnsubscribe = (pageId: string, pageToken: string) => graph(`${pageId}/subscribed_apps`, pageToken, { method: "DELETE" }).catch(() => undefined);
export const metaLead = (leadId: string, pageToken: string) => graph(leadId, pageToken, { query: { fields: LEAD_FIELDS } });

/** Meta webhook signature: X-Hub-Signature-256 = sha256=HMAC(app secret, raw body). */
export function metaSignatureOk(secret: string, raw: string, header?: string) {
  if (!header || !secret) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Lead (Graph object) → the flat record the intake pipeline maps (full_name, phone_number, email, city …). */
export function metaLeadRecord(lead: any, pageName?: string) {
  const obj: any = {};
  for (const f of lead?.field_data || []) obj[f.name] = Array.isArray(f.values) ? f.values.join(", ") : f.values;
  // custom questions ("Which test do you need?") are kept as comments
  const std = /^(full_name|first_name|last_name|email|phone_number|phone|city|state|zip_code|post_code|country|street_address|whatsapp_number|comments|message)$/i;
  const extras = Object.entries(obj).filter(([k]) => !std.test(k));
  if (extras.length && !obj.comments && !obj.message) obj.comments = extras.map(([k, v]) => `${k.replace(/_/g, " ").replace(/\?$/, "")}: ${v}`).join(" · ");
  if (!obj.full_name && (obj.first_name || obj.last_name)) obj.full_name = [obj.first_name, obj.last_name].filter(Boolean).join(" ");
  return {
    ...obj,
    campaign: lead.campaign_name || lead.ad_name || lead.form_id,
    medium: lead.is_organic ? "organic_social" : "paid_social",
    source: lead.platform === "ig" || lead.platform === "instagram" ? "instagram" : "facebook",
    _meta: { leadId: lead.id, formId: lead.form_id, adId: lead.ad_id, page: pageName, createdTime: lead.created_time, platform: lead.platform },
  };
}
export const isInstagramLead = (lead: any) => lead?.platform === "ig" || lead?.platform === "instagram";

/* ───────────────────────── LinkedIn ───────────────────────── */

const LI_SCOPES = ["r_marketing_leadgen_automation", "r_ads", "r_organization_admin"];

async function li(path: string, token: string, init: RequestInit = {}) {
  const { status, json } = await getJson(`${LI_API()}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "LinkedIn-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  if (status === 401) throw new LoginExpired("LinkedIn login has expired or was revoked. Reconnect this connector.");
  if (status >= 400) throw new HttpError(status >= 500 ? 502 : 400, `LinkedIn: ${json?.message || json?.serviceErrorCode || `HTTP ${status}`}`);
  return json;
}
const urnId = (urn: string) => String(urn).split(":").pop()!;
const enc = encodeURIComponent;

/** LinkedIn webhook validation (GET ?challengeCode=…) and notification signature (X-LI-Signature). */
export const liChallenge = (secret: string, code: string) => crypto.createHmac("sha256", secret).update(code).digest("hex");
export function liSignatureOk(secret: string, raw: string, header?: string) {
  if (!header || !secret) return false;
  const sig = String(header).replace(/^hmacsha256=/i, "");
  const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/* ───────────────────────── Google ───────────────────────── */

const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/spreadsheets.readonly"];

/* ───────────────────────── authorize / exchange ───────────────────────── */

export function authorizeUrl(provider: SsoProvider, type: SsoType, app: PlatformApp, state: string, redirect: string, rerequest = false) {
  if (provider === "meta") {
    const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirect, state, response_type: "code", scope: META_SCOPES[type].join(",") });
    if (rerequest) q.set("auth_type", "rerequest");
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`;
  }
  if (provider === "linkedin") return `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: redirect, state, scope: LI_SCOPES.join(" ") })}`;
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: app.clientId, redirect_uri: redirect, response_type: "code", scope: GOOGLE_SCOPES.join(" "), state, access_type: "offline", prompt: "consent", include_granted_scopes: "true" })}`;
}

export interface Tokens {
  token: string;
  refresh?: string;
  expiresAt?: Date;
  scopes: string[];
  account: { id?: string; name?: string };
}

export async function exchangeCode(provider: SsoProvider, app: PlatformApp, code: string, redirect: string): Promise<Tokens> {
  if (provider === "meta") {
    const q = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirect, code });
    const { json } = await getJson(`${GRAPH()}/oauth/access_token?${q}`);
    if (!json.access_token) throw badRequest(`Facebook didn't accept the sign-in: ${json.error?.message || "no access token"}`);
    // short-lived (1–2 h) → long-lived (~60 days); Page tokens derived from it don't expire
    const ll = await getJson(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: app.clientId, client_secret: app.clientSecret, fb_exchange_token: json.access_token })}`);
    const token = ll.json.access_token || json.access_token;
    const me = await graph("me", token, { query: { fields: "id,name" } });
    const perms = await graph("me/permissions", token).catch(() => ({ data: [] }));
    const scopes = (perms.data || []).filter((p: any) => p.status === "granted").map((p: any) => p.permission);
    return { token, expiresAt: ll.json.expires_in ? new Date(Date.now() + ll.json.expires_in * 1000) : undefined, scopes, account: { id: me.id, name: me.name } };
  }
  if (provider === "linkedin") {
    const { json } = await getJson(u("https://www.linkedin.com/oauth/v2/accessToken"), { method: "POST", headers: formHeaders, body: form({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: app.clientId, client_secret: app.clientSecret }) });
    if (!json.access_token) throw badRequest(`LinkedIn didn't accept the sign-in: ${json.error_description || json.error || "no access token"}`);
    return { token: json.access_token, refresh: json.refresh_token, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined, scopes: String(json.scope || "").split(/[ ,]+/).filter(Boolean), account: { name: "LinkedIn member" } };
  }
  const { json } = await getJson(u("https://oauth2.googleapis.com/token"), { method: "POST", headers: formHeaders, body: form({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: app.clientId, client_secret: app.clientSecret }) });
  if (!json.access_token) throw badRequest(`Google didn't accept the sign-in: ${json.error_description || json.error || "no access token"}`);
  const info = await getJson(u("https://openidconnect.googleapis.com/v1/userinfo"), { headers: { Authorization: `Bearer ${json.access_token}` } });
  return { token: json.access_token, refresh: json.refresh_token, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined, scopes: String(json.scope || "").split(" ").filter(Boolean), account: { id: info.json.sub, name: info.json.email || "Google account" } };
}

/** Refresh an access token that is about to expire (LinkedIn with Lead Sync refresh tokens, Google). */
async function refreshToken(provider: "linkedin" | "google", refresh: string) {
  const app = await getApp(provider);
  if (!app) throw new HttpError(409, `${PROVIDER_INFO[provider].label} isn't enabled in Platform Apps any more`);
  const url = provider === "linkedin" ? u("https://www.linkedin.com/oauth/v2/accessToken") : u("https://oauth2.googleapis.com/token");
  const { json } = await getJson(url, { method: "POST", headers: formHeaders, body: form({ grant_type: "refresh_token", refresh_token: refresh, client_id: app.clientId, client_secret: app.clientSecret }) });
  if (!json.access_token) throw new LoginExpired(`${provider === "google" ? "Google" : "LinkedIn"} login has expired or was revoked. Reconnect this connector.`);
  return { token: json.access_token as string, refresh: (json.refresh_token as string) || refresh, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined };
}

/** Valid access token for a connector, refreshed and saved when needed. */
export async function connectorToken(c: any): Promise<string> {
  const o = c.oauth || {};
  if (o.status === "revoked") throw new LoginExpired("Disconnected — connect again to receive leads");
  const tok = decrypt(o.tokenEnc);
  if (!tok) throw new LoginExpired("Not signed in — click Reconnect");
  const soon = o.expiresAt && new Date(o.expiresAt).getTime() < Date.now() + 5 * 60_000;
  if (!soon) return tok;
  const refresh = decrypt(o.refreshEnc);
  if (!refresh || o.provider === "meta") throw new LoginExpired(`${o.provider === "linkedin" ? "LinkedIn" : o.provider === "google" ? "Google" : "Facebook"} login has expired. Reconnect this connector.`);
  const n = await refreshToken(o.provider, refresh);
  await Connector.updateOne({ _id: c._id }, { $set: { "oauth.tokenEnc": encrypt(n.token), "oauth.refreshEnc": encrypt(n.refresh), "oauth.expiresAt": n.expiresAt, "oauth.status": "connected", "oauth.error": null } });
  return n.token;
}

/* ───────────────────────── choices after sign-in ───────────────────────── */

export interface Choice {
  id: string;
  name: string;
  detail?: string;
  disabled?: string; // why it can't be picked
}

/** Pages / accounts the signed-in person can connect. */
export async function listChoices(type: SsoType, token: string): Promise<{ kind: string; items: Choice[]; note?: string }> {
  if (type === "facebook_leads" || type === "instagram_leads") {
    const items: Choice[] = [];
    let after: string | undefined = "";
    for (let i = 0; after !== undefined && i < 5; i++) {
      const r: any = await graph("me/accounts", token, { query: { fields: "id,name,tasks,instagram_business_account{id,username,name}", limit: "100", ...(after ? { after } : {}) } });
      for (const p of r.data || []) {
        const advertise = !p.tasks || p.tasks.includes("ADVERTISE") || p.tasks.includes("MANAGE");
        if (type === "facebook_leads") items.push({ id: p.id, name: p.name, detail: `Page · ${p.id}`, disabled: advertise ? undefined : "You need the Advertise or Manage task on this Page" });
        else
          items.push({
            id: p.id,
            name: p.instagram_business_account ? `@${p.instagram_business_account.username || p.instagram_business_account.name}` : p.name,
            detail: p.instagram_business_account ? `Instagram · linked to ${p.name}` : `${p.name} has no Instagram professional account linked`,
            disabled: !p.instagram_business_account ? "Link an Instagram professional account to this Page first" : advertise ? undefined : "You need the Advertise or Manage task on this Page",
          });
      }
      after = r.paging?.next && r.paging?.cursors?.after ? r.paging.cursors.after : undefined;
    }
    return { kind: type === "facebook_leads" ? "pages" : "instagram", items, note: items.length ? undefined : "No Facebook Pages came back. Reconnect and tick your Pages on Facebook's screen, or ask a Page admin to connect." };
  }
  if (type === "linkedin_leads") {
    const items: Choice[] = [];
    const users = await li("adAccountUsers?q=authenticatedUser", token).catch((e) => (e instanceof LoginExpired ? Promise.reject(e) : { elements: [] }));
    for (const el of (users.elements || []).slice(0, 50)) {
      const id = urnId(el.account);
      const acc = await li(`adAccounts/${id}`, token).catch(() => ({}));
      items.push({ id: el.account, name: acc.name || `Ad account ${id}`, detail: `Ad account · ${id} · ${String(el.role || "").replace(/_/g, " ").toLowerCase()}` });
    }
    const acls = await li("organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED", token).catch((e) => (e instanceof LoginExpired ? Promise.reject(e) : { elements: [] }));
    for (const el of (acls.elements || []).slice(0, 50)) {
      const id = urnId(el.organization);
      const org = await li(`organizations/${id}`, token).catch(() => ({}));
      items.push({ id: el.organization, name: org.localizedName || `Page ${id}`, detail: `LinkedIn Page · ${id}` });
    }
    return { kind: "linkedin", items, note: items.length ? undefined : "No ad accounts or Pages came back. You need the Account Manager, Campaign Manager or Leads Manager role on an ad account, or admin on a Page." };
  }
  return { kind: "sheet", items: [] }; // Google Sheets: the person pastes the sheet link
}

/* ───────────────────────── Google Sheets ───────────────────────── */

export const sheetIdOf = (v: string) => String(v || "").match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1] || (/^[A-Za-z0-9_-]{20,}$/.test(String(v || "").trim()) ? String(v).trim() : "");

export async function sheetInfo(token: string, sheetId: string) {
  const { status, json } = await getJson(u(`https://sheets.googleapis.com/v4/spreadsheets/${enc(sheetId)}?fields=properties.title,sheets.properties.title`), { headers: { Authorization: `Bearer ${token}` } });
  if (status === 401) throw new LoginExpired("Google login has expired or was revoked. Reconnect this connector.");
  if (status === 404) throw badRequest("Sheet not found — check the link, and that the Google account you signed in with can open it");
  if (status === 403) throw badRequest("This Google account can't open that sheet. Share it with the account, or sign in with the owner's account.");
  if (status >= 400) throw badRequest(`Google: ${json?.error?.message || `HTTP ${status}`}`);
  return { title: json.properties?.title as string, tabs: (json.sheets || []).map((s: any) => s.properties?.title).filter(Boolean) as string[] };
}

async function sheetRows(token: string, sheetId: string, tab: string) {
  const range = `'${tab.replace(/'/g, "''")}'!A1:ZZ`;
  const { status, json } = await getJson(u(`https://sheets.googleapis.com/v4/spreadsheets/${enc(sheetId)}/values/${enc(range)}?majorDimension=ROWS`), { headers: { Authorization: `Bearer ${token}` } });
  if (status === 401) throw new LoginExpired("Google login has expired or was revoked. Reconnect this connector.");
  if (status >= 400) throw new HttpError(502, `Google: ${json?.error?.message || `HTTP ${status}`}`);
  return (json.values || []) as string[][];
}

/** Rows already in the tab (incl. header) — "only new rows from now on" starts after these. */
export async function sheetRowCount(token: string, sheetId: string, tab: string) {
  return Math.max(1, (await sheetRows(token, sheetId, tab)).length);
}

/* ───────────────────────── finish: create / update the connector ───────────────────────── */

/** Subscribes the chosen Pages to the app's leadgen webhook and returns the per-Page tokens to store (encrypted). */
export async function metaPagesFor(type: SsoType, token: string, ids: string[]) {
  const r: any = await graph("me/accounts", token, { query: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" } });
  const pages = (r.data || []).filter((p: any) => ids.includes(p.id));
  if (!pages.length) throw badRequest("Pick at least one Page");
  const out: any[] = [];
  for (const p of pages) {
    let subscribed = true;
    let error: string | undefined;
    try {
      await metaPageSubscribe(p.id, p.access_token);
    } catch (e: any) {
      subscribed = false;
      error = e.message;
    }
    out.push({ id: p.id, name: p.name, tokenEnc: encrypt(p.access_token), ig: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username } : undefined, subscribed, error });
  }
  return out;
}

/** Owner-level LinkedIn lead notifications (best effort — the 15-minute pull covers anything missed). */
export async function linkedinSubscribe(token: string, owners: { id: string }[], req?: Request) {
  const res: Record<string, string> = {};
  for (const o of owners) {
    const isOrg = o.id.includes(":organization:");
    try {
      await li("leadNotifications", token, { method: "POST", body: JSON.stringify({ webhook: webhookUrl("linkedin", req), owner: isOrg ? { organization: o.id } : { sponsoredAccount: o.id }, leadType: isOrg ? "COMPANY" : "SPONSORED" }) });
      res[o.id] = "subscribed";
    } catch (e: any) {
      res[o.id] = e.message;
    }
  }
  return res;
}

/** Routes webhook events for these external ids to this connector (main database). */
export async function setRoutes(provider: "meta" | "linkedin", c: any, ids: string[]) {
  await SsoRoute.deleteMany({ connectorKey: c.key });
  if (ids.length) await SsoRoute.insertMany(ids.map((externalId) => ({ provider, externalId, companyId: c.companyId, db: currentDb(), connectorKey: c.key, type: c.type })));
}

/** Withdraw consent: unsubscribe Pages, forget every token, stop routing. */
export async function disconnect(c: any, by: string) {
  for (const p of c.sso?.pages || []) {
    const t = decrypt(p.tokenEnc);
    if (t && c.type === "facebook_leads") {
      // the same Page may also feed an Instagram connector — keep the app installed if so
      const other = await Connector.countDocuments({ _id: { $ne: c._id }, type: "instagram_leads", "sso.pages.id": p.id, "oauth.status": "connected" });
      if (!other) await metaPageUnsubscribe(p.id, t);
    } else if (t && c.type === "instagram_leads") {
      const other = await Connector.countDocuments({ _id: { $ne: c._id }, type: "facebook_leads", "sso.pages.id": p.id, "oauth.status": "connected" });
      if (!other) await metaPageUnsubscribe(p.id, t);
    }
  }
  await SsoRoute.deleteMany({ connectorKey: c.key });
  await ConnectorKey.updateOne({ key: c.key }, { $set: { active: false } });
  const pages = (c.sso?.pages || []).map((p: any) => ({ id: p.id, name: p.name, ig: p.ig }));
  await Connector.updateOne(
    { _id: c._id },
    { $set: { active: false, "oauth.status": "revoked", "oauth.tokenEnc": null, "oauth.refreshEnc": null, "oauth.error": null, "sso.pages": pages, "consent.withdrawnAt": new Date(), "consent.withdrawnBy": by } }
  );
}

/* ───────────────────────── leads: webhook + pull ───────────────────────── */

type Tally = { found: number; created: number; duplicates: number; failed: number };
async function ingest(c: any, payload: any, idem: string, t: Tally) {
  t.found++;
  const r: any = await processIntake(c, payload, idem).catch((e) => ({ ok: false, error: e?.message }));
  if (r?.duplicate || r?.created === false) t.duplicates++;
  else if (r?.ok === false) t.failed++;
  else t.created++;
}

/** One Meta lead for this connector (from the webhook or the pull). Instagram leads go to the Instagram connector. */
export async function ingestMetaLead(c: any, page: any, lead: any, t?: Tally) {
  const tally = t || { found: 0, created: 0, duplicates: 0, failed: 0 };
  await ingest(c, { meta_lead: lead, page: { id: page.id, name: page.name } }, `fb:${lead.id}`, tally);
  return tally;
}

/** Whether a Meta lead belongs to this connector (Facebook vs Instagram placement). */
export function metaLeadIsFor(type: string, lead: any, hasOther: boolean) {
  if (!hasOther) return true; // only one of the two connected for this Page: it takes both placements
  return type === "instagram_leads" ? isInstagramLead(lead) : !isInstagramLead(lead);
}

async function pullMeta(c: any) {
  const since = Math.floor((c.pullCursor ? new Date(c.pullCursor).getTime() - 10 * 60_000 : Date.now() - 3 * 86400_000) / 1000);
  const now = new Date();
  const t: Tally = { found: 0, created: 0, duplicates: 0, failed: 0 };
  const otherType = c.type === "facebook_leads" ? "instagram_leads" : "facebook_leads";
  const notes: string[] = [];
  for (const p of c.sso?.pages || []) {
    const token = decrypt(p.tokenEnc);
    if (!token) continue;
    const hasOther = !!(await Connector.exists({ type: otherType, "sso.pages.id": p.id, active: true, "oauth.status": "connected" }));
    const forms: any = await graph(`${p.id}/leadgen_forms`, token, { query: { fields: "id,name,status", limit: "100" } });
    for (const f of (forms.data || []).slice(0, 50)) {
      let after: string | undefined = "";
      for (let i = 0; after !== undefined && i < 10; i++) {
        const r: any = await graph(`${f.id}/leads`, token, { query: { fields: LEAD_FIELDS, limit: "100", filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]), ...(after ? { after } : {}) } });
        for (const lead of r.data || []) if (metaLeadIsFor(c.type, lead, hasOther)) await ingestMetaLead(c, p, lead, t);
        after = r.paging?.next && r.paging?.cursors?.after ? r.paging.cursors.after : undefined;
      }
    }
    if (!p.subscribed) notes.push(`${p.name}: real-time webhook not active (${p.error || "not subscribed"}) — leads are fetched every 15 minutes`);
  }
  await Connector.updateOne({ _id: c._id }, { $set: { pullCursor: now } });
  return { ok: true, ...t, ...(notes.length ? { note: notes.join(" · ") } : {}) };
}

/** LinkedIn lead form → { questionId: {label, field} } (cached per run). */
async function liFormQuestions(token: string, versioned: string, cache: Map<string, any>) {
  if (cache.has(versioned)) return cache.get(versioned);
  const id = versioned.match(/leadGenForm:(\d+)/)?.[1];
  const map: Record<string, { label: string; field?: string }> = {};
  let name = "";
  if (id) {
    const f = await li(`leadForms/${id}`, token).catch(() => null);
    name = f?.name || "";
    for (const q of f?.content?.questions || f?.questions || []) map[String(q.questionId)] = { label: q.question?.localized ? String(Object.values(q.question.localized)[0]) : q.name, field: q.predefinedField };
  }
  const v = { map, name };
  cache.set(versioned, v);
  return v;
}

const LI_FIELDS: Record<string, string> = { FIRST_NAME: "first_name", LAST_NAME: "last_name", EMAIL: "email", WORK_EMAIL: "email", PHONE_NUMBER: "phone", WORK_PHONE_NUMBER: "phone", CITY: "city", STATE: "state", COUNTRY: "country", ZIP_CODE: "pincode", COMPANY_NAME: "company", JOB_TITLE: "job_title", LINKEDIN_PROFILE_LINK: "profile_url" };

/** LinkedIn lead form response → flat record for the intake pipeline. */
export function linkedinRecord(resp: any, q: { map: Record<string, { label: string; field?: string }>; name: string }) {
  const rec: any = {};
  for (const a of resp?.formResponse?.answers || []) {
    const meta = q.map[String(a.questionId)] || { label: `Question ${a.questionId}` };
    const d = a.answerDetails || {};
    const val = d.textQuestionAnswer?.answer ?? (d.multipleChoiceAnswer?.options || []).join(", ");
    const key = meta.field && LI_FIELDS[meta.field] ? LI_FIELDS[meta.field] : meta.label;
    rec[key] = val;
  }
  if (rec.first_name || rec.last_name) rec.name = [rec.first_name, rec.last_name].filter(Boolean).join(" ");
  const extras = Object.entries(rec).filter(([k]) => !["first_name", "last_name", "name", "email", "phone", "city", "pincode"].includes(k));
  if (extras.length) rec.comments = extras.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ");
  if (rec.profile_url) rec.profileUrl = rec.profile_url;
  rec.campaign = q.name || undefined;
  rec.medium = resp.leadType === "SPONSORED" || resp.leadMetadata?.sponsoredLeadMetadata ? "paid_social" : "organic_social";
  rec.source = "linkedin";
  rec._linkedin = { id: resp.id, form: resp.versionedLeadGenFormUrn, submittedAt: resp.submittedAt, owner: resp.owner };
  return rec;
}

async function pullLinkedIn(c: any) {
  const token = await connectorToken(c);
  const now = Date.now();
  const start = c.pullCursor ? new Date(c.pullCursor).getTime() - 10 * 60_000 : now - 7 * 86400_000;
  const t: Tally = { found: 0, created: 0, duplicates: 0, failed: 0 };
  const forms = new Map<string, any>();
  const owners = [...(c.sso?.adAccounts || []).map((a: any) => ({ urn: a.id, kind: "sponsoredAccount", type: "SPONSORED" })), ...(c.sso?.organizations || []).map((o: any) => ({ urn: o.id, kind: "organization", type: "COMPANY" }))];
  for (const o of owners) {
    for (let page = 0; page < 20; page++) {
      const q = `leadFormResponses?q=owner&owner=(${o.kind}:${enc(o.urn)})&leadType=(leadType:${o.type})&limitedToTestLeads=false&submittedAtTimeRange=(start:${start},end:${now})&count=100&start=${page * 100}`;
      const r = await li(q, token);
      for (const resp of r.elements || []) {
        const qs = await liFormQuestions(token, resp.versionedLeadGenFormUrn || "", forms);
        await ingest(c, { linkedin_lead: linkedinRecord(resp, qs) }, `li:${resp.id}`, t);
      }
      if ((r.elements || []).length < 100) break;
    }
  }
  await Connector.updateOne({ _id: c._id }, { $set: { pullCursor: new Date(now) } });
  return { ok: true, ...t };
}

async function pullSheet(c: any) {
  const token = await connectorToken(c);
  const s = c.sso?.sheet;
  if (!s?.id || !s?.tab) throw badRequest("Pick the sheet and tab first");
  const rows = await sheetRows(token, s.id, s.tab);
  if (!rows.length) return { ok: true, found: 0, created: 0, duplicates: 0, failed: 0 };
  const header = rows[0].map((h) => String(h || "").trim());
  const from = Math.max(1, Number(s.row || 1)); // index of the first unread data row
  const t: Tally = { found: 0, created: 0, duplicates: 0, failed: 0 };
  let i = from;
  for (; i < rows.length && t.found < 1000; i++) {
    const row = rows[i];
    if (!row.some((v) => String(v || "").trim())) continue;
    const obj: any = {};
    header.forEach((h, k) => {
      if (h && row[k] != null && String(row[k]).trim() !== "") obj[h] = row[k];
    });
    obj.source = obj.source || obj.Source || "google_sheets";
    await ingest(c, { sheet_row: obj, row: i + 1 }, `gs:${s.id}:${s.tab}:${i + 1}:${sha256(JSON.stringify(row)).slice(0, 12)}`, t);
  }
  await Connector.updateOne({ _id: c._id }, { $set: { "sso.sheet.row": i } }); // next run starts after the last row read
  return { ok: true, ...t, rows: rows.length - 1 };
}

/** Runs one sign-in connector's fetch. Login problems mark the connector "Reconnect" instead of failing silently. */
export async function runSso(c: any) {
  try {
    const r = c.type === "linkedin_leads" ? await pullLinkedIn(c) : c.type === "google_sheets" ? await pullSheet(c) : await pullMeta(c);
    if (c.oauth?.status !== "connected") await Connector.updateOne({ _id: c._id }, { $set: { "oauth.status": "connected", "oauth.error": null } });
    return r;
  } catch (e: any) {
    if (e instanceof LoginExpired) await Connector.updateOne({ _id: c._id }, { $set: { "oauth.status": "expired", "oauth.error": e.message } });
    return { ok: false, error: e.message, reconnect: e instanceof LoginExpired || undefined };
  }
}

/* ───────────────────────── Super Admin › Test ───────────────────────── */

export async function testApp(provider: SsoProvider, req?: Request) {
  const app = await getApp(provider);
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  if (!app) return { ok: false, checks: [{ label: "Saved", ok: false, detail: `Enter the ${PROVIDER_INFO[provider].idLabel} and ${PROVIDER_INFO[provider].secretLabel}, then Save` }] };
  const host = new URL(platformUrl(req) || "https://localhost").hostname;
  try {
    if (provider === "meta") {
      const { json } = await getJson(`${GRAPH()}/${enc(app.clientId)}?fields=name,app_domains&access_token=${enc(`${app.clientId}|${app.clientSecret}`)}`);
      if (json.error) checks.push({ label: "App ID and App Secret", ok: false, detail: `Meta rejected them: ${json.error.message}. Copy both again from App settings → Basic.` });
      else {
        checks.push({ label: "App ID and App Secret", ok: true, detail: `Accepted — app “${json.name}”` });
        const domains: string[] = json.app_domains || [];
        const ok = domains.some((d) => host === d || host.endsWith(`.${d}`) || d.endsWith(host));
        checks.push({ label: "App Domains", ok, detail: ok ? `Includes ${host}` : `Add ${host} under App settings → Basic → App Domains` });
        // Page lead webhooks for the whole app (object "page", field "leadgen") — set automatically when possible
        const subs = await getJson(`${GRAPH()}/${enc(app.clientId)}/subscriptions?access_token=${enc(`${app.clientId}|${app.clientSecret}`)}`);
        const page = (subs.json.data || []).find((s: any) => s.object === "page");
        const hasLeadgen = page && (page.fields || []).some((f: any) => (f.name || f) === "leadgen") && page.callback_url === webhookUrl("meta", req);
        if (hasLeadgen) checks.push({ label: "Lead webhook", ok: true, detail: `Page › leadgen → ${webhookUrl("meta", req)}` });
        else {
          const set = await getJson(`${GRAPH()}/${enc(app.clientId)}/subscriptions`, {
            method: "POST",
            headers: formHeaders,
            body: form({ object: "page", callback_url: webhookUrl("meta", req), fields: "leadgen", include_values: "true", verify_token: app.verifyToken || "", access_token: `${app.clientId}|${app.clientSecret}` }),
          });
          checks.push(
            set.json.success
              ? { label: "Lead webhook", ok: true, detail: `Subscribed now: Page › leadgen → ${webhookUrl("meta", req)}` }
              : { label: "Lead webhook", ok: false, detail: `Couldn't set it automatically (${set.json.error?.message || "unknown"}). In the Meta app: Webhooks → Page → Callback URL ${webhookUrl("meta", req)}, Verify token ${app.verifyToken} → subscribe to “leadgen”. Until then leads arrive every 15 minutes.` }
          );
        }
      }
    } else {
      const url = provider === "linkedin" ? u("https://www.linkedin.com/oauth/v2/accessToken") : u("https://oauth2.googleapis.com/token");
      const { status, json } = await getJson(url, { method: "POST", headers: formHeaders, body: form({ grant_type: "authorization_code", code: "credoone-connection-test", redirect_uri: callbackUrl(provider, req), client_id: app.clientId, client_secret: app.clientSecret }) });
      const err = String(json.error || "").toLowerCase();
      const desc = String(json.error_description || "");
      if (err.includes("invalid_client") || err.includes("unauthorized_client") || status === 401) checks.push({ label: "Client ID and Secret", ok: false, detail: `${provider === "google" ? "Google" : "LinkedIn"} rejected them${desc ? `: ${desc}` : ""}. Copy both again.` });
      else checks.push({ label: "Client ID and Secret", ok: true, detail: "Accepted (the test sign-in code was refused, as expected)" });
    }
  } catch (e: any) {
    checks.push({ label: "Reach the platform", ok: false, detail: e.message });
  }
  checks.push({ label: "Callback URL to register", ok: true, detail: callbackUrl(provider, req) });
  if (provider === "linkedin") checks.push({ label: "Webhook URL (Webhooks tab)", ok: true, detail: webhookUrl("linkedin", req) });
  const result = { ok: checks.every((c) => c.ok), checks, at: new Date() };
  await PlatformSetting.updateOne({ _id: `app:${provider}` }, { $set: { "value.lastTest": result } });
  return result;
}

/* ───────────────────────── state ───────────────────────── */

export const newState = () => crypto.randomBytes(24).toString("base64url");
export async function readState(id: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(id || "")) throw new HttpError(404, "This sign-in link has expired — click Connect again");
  const s = await OAuthState.findById(id).lean<any>();
  if (!s) throw new HttpError(404, "This sign-in link has expired — click Connect again");
  return s;
}

export const SSO_SCOPES_NEEDED = (type: SsoType) => (SSO_INFO[type].provider === "meta" ? REQUIRED_META : []);

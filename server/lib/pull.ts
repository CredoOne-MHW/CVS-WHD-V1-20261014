import { Connector, ConnectorKey } from "../models";
import { decrypt, sha256 } from "./crypto";
import { processIntake, indiamartRecords } from "./intake";
import { mcpSession, toolItems } from "./mcp";
import { runInDb } from "./context";
import { HttpError } from "./http";
import { assertPublicUrl } from "./net";

/** Connectors whose leads we fetch (as opposed to platforms that push to us). */
export const PULL_TYPES = ["indiamart", "tradeindia", "woocommerce", "mcp"] as const;
const FREQUENT = ["indiamart", "tradeindia", "woocommerce"]; // every 15 minutes
const DAILY = ["mcp"]; // 02:00 IST

type Tally = { found: number; created: number; duplicates: number; failed: number };
async function ingest(c: any, payload: any, idem: string, t: Tally) {
  t.found++;
  const r: any = await processIntake(c, payload, idem).catch((e) => ({ ok: false, error: e?.message }));
  if (r?.duplicate || r?.created === false) t.duplicates++;
  else if (r?.ok === false) t.failed++;
  else t.created++;
}

/* ───────────────────────── IndiaMART Lead Manager — Pull API ─────────────────────────
 * GET https://mapi.indiamart.com/wservce/crm/crmListing/v2/?glusr_crm_key=…&start_time=…&end_time=…
 * Times are IST "DD-Mon-YYYYHH:MM:SS"; window ≤ 7 days; at most one call per 5 minutes (5+/minute blocks the key
 * for 15 minutes); the key expires after 7 days unused — the 15-minute schedule keeps it alive.
 * Rolling window: from 5 minutes before the last successful end to now; UNIQUE_QUERY_ID makes overlaps harmless.
 */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function imTime(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000); // IST = UTC+05:30
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(ist.getUTCDate())}-${MON[ist.getUTCMonth()]}-${ist.getUTCFullYear()}${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
}
const IM_URL = () => process.env.INDIAMART_API_URL || "https://mapi.indiamart.com/wservce/crm/crmListing/v2/";

async function runIndiaMart(c: any) {
  const key = decrypt(c.configSecretEnc);
  if (!key) return { ok: true, skipped: "Pull API key not set — leads arrive by Push only" };
  const now = new Date();
  const from = new Date(Math.max(c.pullCursor ? new Date(c.pullCursor).getTime() - 5 * 60_000 : now.getTime() - 24 * 3600_000, now.getTime() - 7 * 86400_000 + 60_000));
  const u = new URL(IM_URL());
  u.search = new URLSearchParams({ glusr_crm_key: key, start_time: imTime(from), end_time: imTime(now) }).toString();
  const r = await fetch(u, { signal: AbortSignal.timeout(25_000) });
  const j: any = await r.json().catch(() => ({}));
  const code = Number(j.CODE ?? r.status);
  if (code === 204) {
    await Connector.updateOne({ _id: c._id }, { $set: { pullCursor: now } });
    return { ok: true, found: 0, created: 0, duplicates: 0, failed: 0, window: [imTime(from), imTime(now)] };
  }
  if (code === 429) return { ok: true, throttled: true, note: "IndiaMART allows one call per 5 minutes — the next scheduled run will catch up" };
  if (code === 401) throw new HttpError(400, "IndiaMART rejected the key (wrong, regenerated, or expired after 7 days unused). Generate a new key in Lead Manager › Pull API and save it here.");
  if (code !== 200) throw new HttpError(502, `IndiaMART: ${j.MESSAGE || j.STATUS || `HTTP ${r.status}`}`);
  const t: Tally = { found: 0, created: 0, duplicates: 0, failed: 0 };
  for (const rec of indiamartRecords(j)) await ingest(c, { RESPONSE: rec }, `im:${rec.UNIQUE_QUERY_ID || sha256(JSON.stringify(rec))}`, t);
  await Connector.updateOne({ _id: c._id }, { $set: { pullCursor: now } });
  return { ok: true, ...t, window: [imTime(from), imTime(now)] };
}

/* ───────────────────────── TradeIndia — My Inquiry API ─────────────────────────
 * Credentials from TradeIndia › (your name) › Inquiries & Contacts › My Inquiry API: User ID, Profile ID, Key.
 * GET https://www.tradeindia.com/utils/my_inquiry.html?userid=…&profile_id=…&key=…&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&limit=…&page_no=…
 */
const TI_URL = () => process.env.TRADEINDIA_API_URL || "https://www.tradeindia.com/utils/my_inquiry.html";
const ymd = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

async function runTradeIndia(c: any) {
  const o = c.config || {};
  const key = decrypt(c.configSecretEnc);
  if (!o.userId || !o.profileId || !key) throw new HttpError(400, "Add your TradeIndia User ID, Profile ID and Key (TradeIndia › Inquiries & Contacts › My Inquiry API)");
  const now = new Date();
  const from = c.pullCursor ? new Date(new Date(c.pullCursor).getTime() - 86400_000) : new Date(now.getTime() - 2 * 86400_000);
  const t: Tally = { found: 0, created: 0, duplicates: 0, failed: 0 };
  const limit = 100;
  for (let page = 1; page <= 20; page++) {
    const u = new URL(TI_URL());
    u.search = new URLSearchParams({ userid: o.userId, profile_id: o.profileId, key, from_date: ymd(from), to_date: ymd(now), limit: String(limit), page_no: String(page) }).toString();
    const r = await fetch(u, { signal: AbortSignal.timeout(25_000) });
    const text = await r.text();
    if (!r.ok) throw new HttpError(502, `TradeIndia: HTTP ${r.status}`);
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      throw new HttpError(502, `TradeIndia sent an unexpected response: ${text.slice(0, 120)}`);
    }
    if (j && !Array.isArray(j) && (j.error || j.status === "error")) throw new HttpError(400, `TradeIndia: ${j.error || j.message || "check User ID, Profile ID and Key"}`);
    const rows: any[] = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.inquiries) ? j.inquiries : (Object.values(j || {}).find(Array.isArray) as any[]) || [];
    for (const row of rows) {
      const id = row.rfi_id ?? row.inquiry_id ?? row.id ?? row.rfiid;
      await ingest(c, row, `ti:${id != null ? id : sha256(JSON.stringify(row))}`, t);
    }
    if (rows.length < limit) break;
  }
  await Connector.updateOne({ _id: c._id }, { $set: { pullCursor: now } });
  return { ok: true, ...t, window: [ymd(from), ymd(now)] };
}

/* ───────────────────────── WooCommerce — REST API (safety net for missed webhooks) ─────────────────────────
 * GET {site}/wp-json/wc/v3/orders?after=…&orderby=date&order=asc&per_page=100&page=N  (read-only consumer key + secret, HTTPS)
 * Same ids as the webhooks (wc:order:<id>), so an order that arrived by webhook is never stored twice.
 */
export function wooBase(site: string) {
  return String(site || "").trim().replace(/\/+$/, "").replace(/\/wp-json.*$/, "");
}
async function runWooCommerce(c: any) {
  const o = c.config || {};
  const secret = decrypt(c.configSecretEnc);
  if (!o.siteUrl || !o.consumerKey || !secret) return { ok: true, skipped: "REST API keys not set — orders arrive by webhook only" };
  const base = wooBase(o.siteUrl);
  await assertPublicUrl(base);
  const now = new Date();
  const from = c.pullCursor ? new Date(new Date(c.pullCursor).getTime() - 10 * 60_000) : new Date(now.getTime() - 24 * 3600_000);
  const auth = "Basic " + Buffer.from(`${o.consumerKey}:${secret}`).toString("base64");
  const t: Tally = { found: 0, created: 0, duplicates: 0, failed: 0 };
  let ignored = 0;
  for (let page = 1; page <= 10; page++) {
    const u = new URL(`${base}/wp-json/wc/v3/orders`);
    u.search = new URLSearchParams({ after: from.toISOString().slice(0, 19), dates_are_gmt: "true", orderby: "date", order: "asc", per_page: "100", page: String(page) }).toString();
    const r = await fetch(u, { headers: { authorization: auth, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(25_000) });
    if (r.status >= 300 && r.status < 400) throw new HttpError(400, `Your site redirects to ${r.headers.get("location") || "another address"} — enter that address as the Store URL`);
    if (r.status === 401 || r.status === 403) throw new HttpError(400, "WooCommerce refused the keys — create a Read key in WooCommerce → Settings → Advanced → REST API and paste both parts here");
    if (r.status === 404) throw new HttpError(400, "WooCommerce REST API not found at this address — check the Store URL and that permalinks are not 'Plain'");
    if (!r.ok) throw new HttpError(502, `WooCommerce: HTTP ${r.status}`);
    const rows: any[] = await r.json().catch(() => {
      throw new HttpError(502, "WooCommerce sent an unexpected response (a security plugin or cache may be blocking the API)");
    });
    if (!Array.isArray(rows)) throw new HttpError(502, "WooCommerce sent an unexpected response");
    for (const row of rows) {
      const res: any = await processIntake(c, { ...row, _topic: "order.created" }, `wc:order:${row.id}`).catch((e) => ({ ok: false, error: e?.message }));
      if (res?.ignored) ignored++;
      else {
        t.found++;
        if (res?.duplicate || res?.created === false) t.duplicates++;
        else if (res?.ok === false) t.failed++;
        else t.created++;
      }
    }
    if (rows.length < 100) break;
  }
  await Connector.updateOne({ _id: c._id }, { $set: { pullCursor: now } });
  return { ok: true, ...t, ...(ignored ? { ignored } : {}) };
}

/* ───────────────────────── MCP server ───────────────────────── */
async function runMcp(c: any) {
  const o = c.config || {};
  if (!o.serverUrl || !o.toolName) throw new HttpError(400, "Set the MCP server URL and pick a tool");
  const s = await mcpSession(o.serverUrl, decrypt(c.secretEnc) || undefined);
  const items = toolItems(await s.callTool(o.toolName, o.toolArgs || {}), o.itemsPath).slice(0, 500);
  const t: Tally = { found: 0, created: 0, duplicates: 0, failed: 0 };
  for (const it of items) {
    const id = it?.id ?? it?.Id ?? it?.record_id ?? it?.uuid;
    await ingest(c, { ...it, source: it?.source || o.defaultSource || "mcp" }, `mcp:${id != null ? String(id) : sha256(JSON.stringify(it))}`, t);
  }
  return { ok: true, ...t };
}

/** Runs one pull connector now (also used by "Run now"). Must be called inside the company's database context. */
export async function runPull(c: any) {
  let result: any;
  try {
    result = c.type === "indiamart" ? await runIndiaMart(c) : c.type === "tradeindia" ? await runTradeIndia(c) : c.type === "woocommerce" ? await runWooCommerce(c) : c.type === "mcp" ? await runMcp(c) : { ok: false, error: "Not a pull connector" };
  } catch (e: any) {
    result = { ok: false, error: e.message };
  }
  await Connector.updateOne({ _id: c._id }, { $set: { lastRunAt: new Date(), lastRun: result } });
  return result;
}

/** Scheduled pulls for every company, each in its own database. `frequent` = IndiaMART + TradeIndia + WooCommerce (15 min); otherwise MCP (daily). */
export async function runPullConnectors(which: "frequent" | "daily" = "daily") {
  const regs = await ConnectorKey.find({ type: { $in: which === "frequent" ? FREQUENT : DAILY }, active: true }).lean<any[]>();
  const out: any[] = [];
  for (const reg of regs) {
    const r = await runInDb(reg.db, async () => {
      const c = await Connector.findOne({ key: reg.key, active: true }).lean<any>();
      return c ? { connector: c.name, type: c.type, ...(await runPull(c)) } : null;
    });
    if (r) out.push(r);
  }
  return { connectors: out.length, results: out };
}

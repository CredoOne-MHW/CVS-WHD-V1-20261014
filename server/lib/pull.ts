import { Connector, ConnectorKey, Prospect } from "../models";
import { decrypt, sha256 } from "./crypto";
import { processIntake } from "./intake";
import { mcpSession, toolItems } from "./mcp";
import { runInDb } from "./context";
import { HttpError } from "./http";

/* ───────────────────────── Google Search (keyword prospecting) ─────────────────────────
 * Google never tells anyone WHO searched for a keyword. What we can do daily is search the public web for your
 * keywords (e.g. "need full body checkup Kolkata", "diagnostic centre near Salt Lake") and keep what is public:
 * listings, posts, enquiries and business pages. Results that show a phone number or email become leads; the rest
 * are kept as prospects to review. For people who actually search on Google, use Google Ads lead forms.
 */
type Hit = { title: string; url: string; snippet: string; phone?: string };

const PROVIDERS = {
  /** SerpAPI — real Google results (organic + local pack with phone numbers). */
  async serpapi(key: string, q: string, o: any): Promise<Hit[]> {
    const u = new URL("https://serpapi.com/search.json");
    u.search = new URLSearchParams({ engine: "google", q, api_key: key, gl: o.country || "in", hl: o.language || "en", num: String(o.max || 20), ...(o.location ? { location: o.location } : {}), ...(o.recent ? { tbs: "qdr:d" } : {}) }).toString();
    const r = await fetch(u, { signal: AbortSignal.timeout(25_000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new HttpError(502, `SerpAPI: ${j.error || r.status}`);
    const local = (j.local_results?.places || j.local_results || []).map?.((p: any) => ({ title: p.title, url: p.website || p.links?.website || `https://www.google.com/maps/search/${encodeURIComponent(p.title)}`, snippet: [p.address, p.type, p.description].filter(Boolean).join(" · "), phone: p.phone })) || [];
    return [...local, ...(j.organic_results || []).map((x: any) => ({ title: x.title, url: x.link, snippet: x.snippet || "" }))];
  },
  /** Brave Search API — independent index, simple API key. */
  async brave(key: string, q: string, o: any): Promise<Hit[]> {
    const u = new URL("https://api.search.brave.com/res/v1/web/search");
    u.search = new URLSearchParams({ q: o.location ? `${q} ${o.location}` : q, country: (o.country || "in").toUpperCase(), count: String(Math.min(o.max || 20, 20)), ...(o.recent ? { freshness: "pd" } : {}) }).toString();
    const r = await fetch(u, { headers: { accept: "application/json", "x-subscription-token": key }, signal: AbortSignal.timeout(25_000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(502, `Brave Search: ${j?.error?.detail || r.status}`);
    return (j.web?.results || []).map((x: any) => ({ title: x.title, url: x.url, snippet: (x.description || "").replace(/<[^>]+>/g, "") }));
  },
  /** Google Programmable Search (Custom Search JSON API) — closed to new customers, switched off by Google on 1 Jan 2027. */
  async google_cse(key: string, q: string, o: any): Promise<Hit[]> {
    if (!o.cx) throw new HttpError(400, "Google Programmable Search needs a Search engine ID (cx)");
    const out: Hit[] = [];
    for (let start = 1; start <= Math.min(o.max || 10, 20); start += 10) {
      const u = new URL("https://www.googleapis.com/customsearch/v1");
      u.search = new URLSearchParams({ key, cx: o.cx, q: o.location ? `${q} ${o.location}` : q, gl: o.country || "in", num: "10", start: String(start), ...(o.recent ? { dateRestrict: "d1" } : {}) }).toString();
      const r = await fetch(u, { signal: AbortSignal.timeout(25_000) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new HttpError(502, `Google Programmable Search: ${j?.error?.message || r.status}`);
      out.push(...(j.items || []).map((x: any) => ({ title: x.title, url: x.link, snippet: x.snippet || "" })));
      if (!j.queries?.nextPage) break;
    }
    return out;
  },
};
export const SEARCH_PROVIDERS = Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[];

const PHONE = /(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export function extractContacts(text: string) {
  const phones = [...new Set((text.match(PHONE) || []).map((p) => p.replace(/\D/g, "").slice(-10)).filter((p) => /^[6-9]\d{9}$/.test(p)))];
  const emails = [...new Set((text.match(EMAIL) || []).map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|gif|webp)$/.test(e) && !/^(noreply|no-reply|example)@/.test(e)))];
  return { phones, emails };
}

async function runGoogleSearch(c: any) {
  const o = c.config || {};
  const key = decrypt(c.secretEnc);
  if (!key) throw new HttpError(400, "Add the search API key in the connector settings");
  const provider = (o.provider || "serpapi") as keyof typeof PROVIDERS;
  if (!PROVIDERS[provider]) throw new HttpError(400, `Unknown search provider "${provider}"`);
  const keywords: string[] = (o.keywords || []).slice(0, 25);
  if (!keywords.length) throw new HttpError(400, "Add at least one keyword");
  const sites: string[] = (o.sites || []).filter(Boolean).slice(0, 10);
  let found = 0, created = 0, duplicates = 0, prospects = 0;
  const errors: string[] = [];
  for (const kw of keywords) {
    const q = sites.length ? `${kw} (${sites.map((s) => `site:${s}`).join(" OR ")})` : kw;
    let hits: Hit[] = [];
    try {
      hits = await PROVIDERS[provider](key, q, { ...o, max: Math.min(Number(o.maxResults) || 20, 50), recent: o.recentOnly !== false });
    } catch (e: any) {
      errors.push(`${kw}: ${e.message}`);
      continue;
    }
    for (const h of hits) {
      if (!h.url) continue;
      found++;
      const { phones, emails } = extractContacts(`${h.title} ${h.snippet} ${h.phone || ""}`);
      const existing = await Prospect.findOneAndUpdate(
        { connectorId: c._id, url: h.url },
        { $setOnInsert: { companyId: c.companyId, connectorId: c._id, keyword: kw, title: h.title, url: h.url, snippet: h.snippet, phones, emails } },
        { upsert: true, new: false }
      ).lean<any>();
      if (existing) continue; // seen on an earlier day
      prospects++;
      if (!phones.length && !emails.length) continue;
      const r: any = await processIntake(c, { name: h.title.slice(0, 120), phone: phones[0], email: emails[0], comments: `${h.snippet}\n${h.url}`.slice(0, 1500), campaign: kw, source: "google_search", medium: "organic_search" }, `gs:${sha256(h.url)}`).catch(() => null);
      if (r?.leadId) {
        await Prospect.updateOne({ connectorId: c._id, url: h.url }, { $set: { leadId: r.leadId, status: "lead" } });
        r.created === false || r.duplicate ? duplicates++ : created++;
      }
    }
  }
  return { ok: !errors.length || found > 0, found, newProspects: prospects, created, duplicates, errors: errors.slice(0, 5) };
}

/* ───────────────────────── MCP server pull ───────────────────────── */
async function runMcp(c: any) {
  const o = c.config || {};
  if (!o.serverUrl || !o.toolName) throw new HttpError(400, "Set the MCP server URL and pick a tool");
  const s = await mcpSession(o.serverUrl, decrypt(c.secretEnc) || undefined);
  const items = toolItems(await s.callTool(o.toolName, o.toolArgs || {}), o.itemsPath).slice(0, 500);
  let created = 0, duplicates = 0, failed = 0;
  for (const it of items) {
    const id = it?.id ?? it?.Id ?? it?.record_id ?? it?.uuid;
    const r: any = await processIntake(c, { ...it, source: it?.source || o.defaultSource || "mcp" }, `mcp:${id != null ? String(id) : sha256(JSON.stringify(it))}`).catch(() => ({ ok: false }));
    if (r?.duplicate || r?.created === false) duplicates++;
    else if (r?.ok === false) failed++;
    else created++;
  }
  return { ok: true, found: items.length, created, duplicates, failed };
}

/** Runs one pull connector now (also used by the "Run now" button). Must be called inside the company's database context. */
export async function runPull(c: any) {
  let result: any;
  try {
    result = c.type === "google_search" ? await runGoogleSearch(c) : c.type === "mcp" ? await runMcp(c) : { ok: false, error: "Not a pull connector" };
  } catch (e: any) {
    result = { ok: false, error: e.message };
  }
  await Connector.updateOne({ _id: c._id }, { $set: { lastRunAt: new Date(), lastRun: result } });
  return result;
}

/** Daily 02:00 IST: every active Google Search / MCP connector of every company, each in its own database. */
export async function runPullConnectors() {
  const regs = await ConnectorKey.find({ type: { $in: ["google_search", "mcp"] }, active: true }).lean<any[]>();
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

/**
 * Public Web Prospecting — finds people who publicly asked for what the company sells, from sources that allow it.
 *
 * Sources (each switchable per connector):
 *  - web:     web pages & blogs found through the company's own search API key (Brave Search API or SerpAPI)
 *  - feeds:   RSS/Atom feeds and public pages the company lists (blogs, forums, community boards)
 *  - bluesky: public Bluesky posts (official API, the company's own app password)
 * Not supported by design: LinkedIn, Facebook, Instagram, X, Quora, Reddit, WhatsApp/Telegram groups — their terms
 * prohibit automated collection / identifying users, or they need a login.
 *
 * Ethics & law (India DPDP Act s.3(c)(ii) covers personal data the person made public themselves):
 *  - robots.txt is obeyed (our own user-agent, then *), pages marked "noai" are skipped, no logins, no CAPTCHAs, no proxies;
 *    polite: ≥1 s between requests to a site and at most 5 pages per site per run
 *  - the AI keeps only contact details the person published about THEMSELVES in that content; every phone/email is
 *    re-checked against the page text, so nothing invented or guessed is ever stored
 *  - no health conditions or other sensitive details; the evidence quote and source link are kept for provenance
 *  - these leads are never sent the automatic WhatsApp welcome (no opt-in) and untouched ones are deleted after the
 *    retention period
 *
 * Runtime: the 15-minute worker (/api/cron/prospect) seeds each connector once a day from 02:00 IST and then works through
 * its queue in short time-boxed slices (serverless functions are limited to 60 s) — any number of companies and pages.
 */
import { Connector, Lead, AiAgent, ConnectorKey, Company } from "../models";
import { decrypt, sha256 } from "./crypto";
import { assertPublicUrl } from "./net";
import { cached } from "./cache";
import { HttpError } from "./http";
import { complete, parseJson } from "./ai";
import { withAgentDb } from "./agentic";
import { runInDb } from "./context";
import { isSuppressed } from "./suppress";

export const PROSPECT_SOURCES = ["web", "feeds", "bluesky"] as const;
/** Sites whose terms forbid automated collection or that need a login — never fetched, even if a search returns them. */
export const BLOCKED_SITES = ["linkedin.com", "facebook.com", "fb.com", "instagram.com", "x.com", "twitter.com", "quora.com", "reddit.com", "redd.it", "whatsapp.com", "wa.me", "t.me", "telegram.org", "threads.net", "tiktok.com", "pinterest.com", "snapchat.com", "justdial.com", "indiamart.com", "sulekha.com", "tradeindia.com"];

type Kind = "web" | "feed" | "page" | "bluesky";
export type Item = { kind: Kind; url: string; title?: string; snippet?: string; text?: string; keyword?: string; at?: string; author?: { name?: string; handle?: string; profileUrl?: string } };
export type Person = {
  name: string;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  profileUrl: string | null;
  location: string;
  organisation: string;
  role: string;
  requirement: string;
  intent: "high" | "medium" | "low";
  quote: string;
};
export type Row = Person & { sourceUrl: string; sourceTitle: string; sourceKind: Kind; keyword: string };
type Log = { at: string; msg: string }[];

const NA = "NA";
const UA = () => `LeadHiveBot/1.0 (+${(process.env.APP_BASE_URL || "https://mhw.credovation.tech").replace(/\/+$/, "")}/bot)`;
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const onList = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clip = (s: any, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* ───────────────────────── polite fetching ───────────────────────── */

const lastHit = new Map<string, number>(); // per-host politeness within this instance
async function politeFetch(url: string, opts: { accept?: string; maxBytes?: number; headers?: Record<string, string> } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = await assertPublicUrl(current);
    const host = u.hostname;
    const wait = (lastHit.get(host) || 0) + 1000 - Date.now();
    if (wait > 0) await sleep(Math.min(wait, 1000));
    lastHit.set(host, Date.now());
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "user-agent": UA(), accept: opts.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8", ...(opts.headers || {}) } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      current = new URL(r.headers.get("location")!, u).toString();
      if (!(await robotsAllows(current))) throw new Error("blocked by robots.txt after redirect");
      continue;
    }
    const max = opts.maxBytes || 1_500_000;
    const len = Number(r.headers.get("content-length") || 0);
    if (len > max) throw new Error("page too large");
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    return { status: r.status, url: current, type: r.headers.get("content-type") || "", robotsTag: r.headers.get("x-robots-tag") || "", body };
  }
  throw new Error("too many redirects");
}

/* ───────────────────────── robots.txt ───────────────────────── */

type Rules = { allow: boolean; path: string }[];
function parseRobots(txt: string): { ours: Rules | null; star: Rules | null; delay: number } {
  const groups: { agents: string[]; rules: Rules; delay: number }[] = [];
  let cur: { agents: string[]; rules: Rules; delay: number } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: 0 };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === "allow" || k === "disallow") {
      if (v || k === "allow") cur.rules.push({ allow: k === "allow", path: v });
    } else if (k === "crawl-delay") cur.delay = Math.min(10, Number(v) || 0);
  }
  const ours = groups.find((g) => g.agents.some((a) => a !== "*" && "leadhivebot".includes(a.replace(/\/.*$/, ""))));
  const star = groups.find((g) => g.agents.includes("*"));
  return { ours: ours?.rules || null, star: star?.rules || null, delay: (ours || star)?.delay || 0 };
}
function ruleMatches(path: string, rule: string) {
  if (!rule) return false;
  const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return re.test(path);
}
/** Longest matching rule wins; ties go to Allow. Missing robots.txt (4xx) = allowed; unreachable (5xx/network) = not allowed. */
export async function robotsAllows(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const txt = await cached(`robots:${u.origin}`, 86400, async () => {
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": UA() } });
      if (r.status >= 500) return "__unreachable__";
      if (!r.ok) return "";
      return (await r.text()).slice(0, 200_000);
    } catch {
      return "__unreachable__";
    }
  });
  if (txt === "__unreachable__") return false;
  const { ours, star } = parseRobots(txt);
  const rules = ours || star;
  if (!rules?.length) return true;
  const path = u.pathname + u.search;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    if (!ruleMatches(path, r.path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

/* ───────────────────────── text helpers ───────────────────────── */

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
export function htmlToText(html: string) {
  const links = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const h = decode(m[1]);
    if (/^(mailto:|tel:|https?:\/\/(wa\.me|api\.whatsapp\.com|bsky\.app\/profile))/i.test(h)) links.add(h);
  }
  const text = decode(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/article|\/section)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { text, links: [...links].slice(0, 50) };
}
/** Only the parts of a page around the keywords go to the AI — cheaper, faster, and less unrelated personal data. */
export function keywordWindows(text: string, keywords: string[], max = 7000) {
  const lower = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    let i = lower.indexOf(k);
    let n = 0;
    while (i >= 0 && n < 8) {
      spans.push([Math.max(0, i - 1200), Math.min(text.length, i + k.length + 1200)]);
      i = lower.indexOf(k, i + k.length);
      n++;
    }
  }
  if (!spans.length) return "";
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  let out = "";
  for (const [a, b] of merged) {
    if (out.length >= max) break;
    out += (out ? "\n…\n" : "") + text.slice(a, b);
  }
  return out.slice(0, max);
}
const metaRobots = (html: string) => (html.match(/<meta[^>]+name\s*=\s*["'](?:robots|leadhivebot)["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1] || "").toLowerCase();

/* ───────────────────────── sources ───────────────────────── */

const BRAVE_URL = () => process.env.BRAVE_API_URL || "https://api.search.brave.com/res/v1/web/search";
const SERP_URL = () => process.env.SERPAPI_URL || "https://serpapi.com/search.json";
const BSKY = () => (process.env.BSKY_SERVICE || "https://bsky.social").replace(/\/+$/, "");

async function webSearch(cfg: any, key: string, q: string): Promise<{ url: string; title: string; snippet: string }[]> {
  if (cfg.searchProvider === "serpapi") {
    const u = new URL(SERP_URL());
    u.search = new URLSearchParams({ engine: "google", q, api_key: key, num: "20", gl: "in", hl: "en", tbs: cfg.freshness === "week" ? "qdr:w" : "qdr:d" }).toString();
    const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new HttpError(400, `SerpAPI: ${j.error || `HTTP ${r.status}`}`);
    return (j.organic_results || []).map((x: any) => ({ url: x.link, title: x.title, snippet: x.snippet }));
  }
  const u = new URL(BRAVE_URL());
  u.search = new URLSearchParams({ q, count: "20", country: "IN", freshness: cfg.freshness === "week" ? "pw" : "pd" }).toString();
  const r = await fetch(u, { headers: { "X-Subscription-Token": key, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403 || r.status === 422) throw new HttpError(400, "Brave Search rejected the API key");
  if (r.status === 429) throw new HttpError(429, "Brave Search: monthly or per-second limit reached");
  if (!r.ok) throw new HttpError(502, `Brave Search: HTTP ${r.status}`);
  const web = (j.web?.results || []).map((x: any) => ({ url: x.url, title: x.title, snippet: x.description }));
  const disc = (j.discussions?.results || []).map((x: any) => ({ url: x.url, title: x.title, snippet: x.description }));
  return [...disc, ...web];
}

function parseFeed(xml: string) {
  const out: { url: string; title: string; snippet: string; at?: string }[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  const tag = (b: string, t: string) => {
    const m = b.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, "i"));
    return m ? decode(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " ") : "";
  };
  for (const b of blocks.slice(0, 100)) {
    const link = b.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1] || tag(b, "link").trim() || tag(b, "guid").trim();
    if (!/^https?:\/\//i.test(link)) continue;
    out.push({ url: decode(link), title: clip(tag(b, "title"), 200), snippet: clip(tag(b, "description") || tag(b, "summary") || tag(b, "content"), 1500), at: tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || undefined });
  }
  return out;
}

async function blueskySession(handle: string, password: string) {
  const r = await fetch(`${BSKY()}/xrpc/com.atproto.server.createSession`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: handle, password }), signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.accessJwt) throw new HttpError(400, `Bluesky sign-in failed (${j.message || r.status}) — use an App Password from Bluesky › Settings › Privacy and security › App passwords`);
  return j.accessJwt as string;
}
async function blueskySearch(jwt: string, q: string, since: Date) {
  const u = new URL(`${BSKY()}/xrpc/app.bsky.feed.searchPosts`);
  u.search = new URLSearchParams({ q, sort: "latest", limit: "50", since: since.toISOString() }).toString();
  const r = await fetch(u, { headers: { authorization: `Bearer ${jwt}`, "user-agent": UA() }, signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `Bluesky search: ${j.message || r.status}`);
  return (j.posts || []).map((p: any) => {
    const rkey = String(p.uri || "").split("/").pop();
    const handle = p.author?.handle;
    return {
      kind: "bluesky" as Kind,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      title: `Bluesky post by @${handle}`,
      text: clip(p.record?.text, 3000),
      at: p.record?.createdAt,
      author: { name: p.author?.displayName || undefined, handle, profileUrl: `https://bsky.app/profile/${handle}` },
    };
  });
}

/* ───────────────────────── AI structuring ───────────────────────── */

function systemPrompt(company: string, cfg: any) {
  return `You find sales leads for ${company} in PUBLIC web content. The company offers: ${(cfg.keywords || []).join(", ")}${cfg.location ? ` in or near ${cfg.location}` : ""}.
Return ONLY JSON: {"people":[{"name":null,"phone":null,"email":null,"whatsapp":null,"profile_url":null,"location":null,"organisation":null,"role":null,"requirement":null,"intent":"high|medium|low","quote":"","self_published":true}]}
Rules:
- Include a person or organisation ONLY if the content shows THEY are looking for, asking about or interested in buying what the company offers. Sellers advertising their own similar services, journalists, and people merely mentioned are NOT leads.
- Contact details: copy only phone numbers, emails, WhatsApp numbers or profile links that this person published about THEMSELVES in this content, exactly as written. Never guess, construct or complete an email/number, never take details of someone else, never combine with other sources. self_published=false if unsure.
- Use null for anything not stated. Do not invent names.
- requirement: the service/product they want in a few neutral words. NEVER record health conditions, diagnoses, symptoms, religion, caste, politics, sexuality or finances — describe only the service needed.
- quote: up to 160 characters copied verbatim from the content that shows the interest.
- intent: high = explicitly asking to buy/book/get a quote now; medium = asking for recommendations or prices; low = vague interest.
- At most 10 people. If there are none, return {"people":[]}.`;
}

const digits = (s: string) => s.replace(/\D/g, "");
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** Keep only what the AI copied from the source: phones/emails must literally appear in the text (anti-hallucination). */
function verifyPerson(raw: any, haystack: string, item: Item): Person | null {
  if (!raw || raw.self_published === false) return null;
  const hayDigits = digits(haystack);
  const hayLower = haystack.toLowerCase();
  const phoneOk = (p: any) => {
    const d = digits(String(p || ""));
    const last10 = d.slice(-10);
    return d.length >= 10 && d.length <= 13 && hayDigits.includes(last10) ? String(p).trim() : null;
  };
  const email = raw.email && EMAIL.test(String(raw.email).trim()) && hayLower.includes(String(raw.email).trim().toLowerCase()) ? String(raw.email).trim().toLowerCase() : null;
  let profileUrl: string | null = null;
  if (item.kind === "bluesky") profileUrl = item.author?.profileUrl || null;
  else if (raw.profile_url && /^https?:\/\//i.test(raw.profile_url) && hayLower.includes(String(raw.profile_url).toLowerCase().replace(/\/+$/, "")) && !onList(hostOf(raw.profile_url), BLOCKED_SITES)) profileUrl = String(raw.profile_url).trim();
  const intent = ["high", "medium", "low"].includes(raw.intent) ? raw.intent : "low";
  const s = (v: any, n: number) => (v == null || String(v).trim() === "" || /^(null|n\/?a|unknown|none)$/i.test(String(v).trim()) ? NA : clip(v, n));
  return {
    name: s(raw.name || (item.kind === "bluesky" ? item.author?.name : null), 120),
    phone: phoneOk(raw.phone),
    email,
    whatsapp: phoneOk(raw.whatsapp),
    profileUrl,
    location: s(raw.location, 160),
    organisation: s(raw.organisation, 120),
    role: s(raw.role, 80),
    requirement: s(raw.requirement, 200),
    intent,
    quote: clip(raw.quote, 160),
  };
}

const INTENT_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };
async function extract(agent: any, companyId: string, company: string, cfg: any, item: Item, content: string, links: string[]): Promise<Person[]> {
  const head = `Source: ${item.kind}${item.title ? ` — ${item.title}` : ""}\nURL: ${item.url}${item.author ? `\nAuthor: ${item.author.name || ""} (@${item.author.handle})` : ""}${links.length ? `\nContact links on the page: ${links.join(" ")}` : ""}\n---\n`;
  const r = await complete({ agent, companyId, system: systemPrompt(company, cfg), messages: [{ role: "user", content: head + content }], purpose: "prospecting", json: true, maxTokens: 1200, timeoutMs: 25_000 });
  const j = parseJson(r.text) || {};
  const hay = `${content}\n${links.join(" ")}`;
  const min = INTENT_RANK[cfg.minIntent || "medium"] || 2;
  return (Array.isArray(j.people) ? j.people : [])
    .slice(0, 10)
    .map((p: any) => verifyPerson(p, hay, item))
    .filter((p: Person | null): p is Person => !!p && INTENT_RANK[p.intent] >= min);
}

/* ───────────────────────── seeding & working ───────────────────────── */

const seenKey = (it: Item) => sha256(it.kind === "page" ? `${it.url}|${new Date().toISOString().slice(0, 10)}` : it.url).slice(0, 24);

/** Collects candidate items from the enabled sources (no AI, no page fetches except feeds/pages lists). */
async function gather(c: any, log: Log, limit: number): Promise<Item[]> {
  const cfg = c.config || {};
  const src = cfg.sources || {};
  const keywords: string[] = cfg.keywords || [];
  const excluded = [...BLOCKED_SITES, ...(cfg.excludeDomains || []).map((d: string) => d.toLowerCase().replace(/^www\./, ""))];
  const seen = new Set<string>(c.prospectSeen || []);
  const out: Item[] = [];
  const push = (it: Item) => {
    const host = hostOf(it.url);
    if (!host || onList(host, excluded)) return;
    const k = seenKey(it);
    if (seen.has(k) || out.some((x) => seenKey(x) === k)) return;
    out.push(it);
  };
  const note = (msg: string) => log.push({ at: new Date().toISOString(), msg });

  if (src.web) {
    const key = decrypt(c.configSecretEnc);
    if (!key) note("Web & blogs: add your search API key in Settings");
    else
      for (const kw of keywords) {
        if (out.length >= limit) break;
        try {
          const res = await webSearch(cfg, key, cfg.location ? `${kw} ${cfg.location}` : kw);
          const before = out.length;
          for (const x of res) if (x.url) push({ kind: "web", url: x.url, title: clip(x.title, 200), snippet: clip(x.snippet, 500), keyword: kw });
          note(`Web search “${kw}”: ${res.length} results, ${out.length - before} new`);
        } catch (e: any) {
          note(`Web search “${kw}”: ${e.message}`);
          if (e instanceof HttpError && e.status === 400) break; // bad key — don't repeat for every keyword
        }
      }
  }
  if (src.feeds) {
    for (const f of cfg.feedUrls || []) {
      if (out.length >= limit) break;
      try {
        if (!(await robotsAllows(f))) {
          note(`${hostOf(f)}: robots.txt does not allow automated access — skipped`);
          continue;
        }
        const r = await politeFetch(f, { accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,text/html;q=0.8" });
        if (r.status >= 400) {
          note(`${f}: HTTP ${r.status}`);
          continue;
        }
        if (/<(rss|feed|rdf:RDF)\b/i.test(r.body.slice(0, 2000))) {
          const items = parseFeed(r.body);
          const match = items.filter((i) => keywords.some((k) => `${i.title} ${i.snippet}`.toLowerCase().includes(k.toLowerCase())));
          for (const i of match) push({ kind: "feed", url: i.url, title: i.title, snippet: i.snippet, at: i.at, keyword: keywords.find((k) => `${i.title} ${i.snippet}`.toLowerCase().includes(k.toLowerCase())) });
          note(`Feed ${hostOf(f)}: ${items.length} items, ${match.length} mention your keywords`);
        } else {
          push({ kind: "page", url: r.url, title: clip(r.body.match(/<title[^>]*>([^<]*)/i)?.[1] || f, 200) });
          note(`Page ${hostOf(f)}: queued for reading`);
        }
      } catch (e: any) {
        note(`${f}: ${e.message}`);
      }
    }
  }
  if (src.bluesky) {
    const pass = decrypt(c.secretEnc);
    if (!cfg.blueskyHandle || !pass) note("Bluesky: add your handle and App Password in Settings");
    else
      try {
        const jwt = await blueskySession(cfg.blueskyHandle, pass);
        const since = new Date(Date.now() - (cfg.freshness === "week" ? 7 : 1) * 86400_000);
        for (const kw of keywords) {
          if (out.length >= limit) break;
          const posts = await blueskySearch(jwt, cfg.location ? `${kw} ${cfg.location}` : kw, since);
          const before = out.length;
          for (const p of posts) push({ ...p, keyword: kw });
          note(`Bluesky “${kw}”: ${posts.length} posts, ${out.length - before} new`);
        }
      } catch (e: any) {
        note(`Bluesky: ${e.message}`);
      }
  }
  return out.slice(0, limit);
}

/** Reads one item and returns the structured people (verified), or a reason it was skipped. */
async function processItem(c: any, agent: any, company: string, it: Item, perHost: Map<string, number>): Promise<{ people: Person[]; skipped?: string }> {
  const cfg = c.config || {};
  const keywords: string[] = cfg.keywords || [];
  if (it.kind === "bluesky") {
    if (!keywords.some((k) => (it.text || "").toLowerCase().includes(k.toLowerCase().split(" ")[0]))) return { people: [], skipped: "post doesn't mention the keywords" };
    return { people: await extract(agent, String(c.companyId), company, cfg, it, it.text || "", []) };
  }
  const host = hostOf(it.url);
  if ((perHost.get(host) || 0) >= 5) return { people: [], skipped: "5 pages from this site already read in this run" };
  if (!(await robotsAllows(it.url))) return { people: [], skipped: "robots.txt does not allow automated access" };
  perHost.set(host, (perHost.get(host) || 0) + 1);
  const r = await politeFetch(it.url);
  if (r.status >= 400) return { people: [], skipped: `HTTP ${r.status}` };
  if (!/html|text\/plain|xml/i.test(r.type)) return { people: [], skipped: "not a web page" };
  const robots = `${metaRobots(r.body)} ${r.robotsTag.toLowerCase()}`;
  if (/\bnoai\b|\bnone\b/.test(robots)) return { people: [], skipped: "page opts out of AI use (noai)" };
  if (/(type=["']password["']|name=["']password["'])/i.test(r.body) && /(log ?in|sign ?in)/i.test(r.body.slice(0, 20000)) && r.body.length < 20000) return { people: [], skipped: "login page" };
  const { text, links } = htmlToText(r.body);
  const windows = keywordWindows(text, keywords);
  if (!windows) return { people: [], skipped: "page doesn't mention the keywords" };
  return { people: await extract(agent, String(c.companyId), company, cfg, it, windows, links) };
}

const toRow = (p: Person, it: Item): Row => ({ ...p, sourceUrl: it.url, sourceTitle: it.title || hostOf(it.url), sourceKind: it.kind, keyword: it.keyword || "" });
const contactable = (cfg: any, p: Person) => (cfg.requireContact ? !!(p.phone || p.email || p.whatsapp) : !!(p.phone || p.email || p.whatsapp || p.profileUrl));

async function loadModel(c: any) {
  const cfg = c.config || {};
  if (!cfg.aiAgentId) throw new HttpError(400, "Choose the AI model in Settings");
  const agent = await AiAgent.findOne({ _id: cfg.aiAgentId, active: true }).lean<any>();
  if (!agent) throw new HttpError(400, "The selected AI model is no longer available — choose another in Settings");
  const company = await Company.findById(c.companyId).select("name").lean<any>();
  return { agent, company: company?.name || "the company" };
}

/**
 * Test Now: a dry run on a few items — nothing is saved, the connector's queue is untouched. AI credits are used.
 */
export async function testProspect(c: any, opts: { maxItems?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const { agent, company } = await loadModel(c);
  return withAgentDb(String(c.companyId), agent._id, async () => {
    const log: Log = [];
    const items = await gather({ ...c, prospectSeen: [] }, log, opts.maxItems ?? 6);
    const rows: Row[] = [];
    const perHost = new Map<string, number>();
    let read = 0;
    for (const it of items) {
      if (Date.now() - started > budget) {
        log.push({ at: new Date().toISOString(), msg: `Stopped after ${read} item(s) to stay within the time limit — the scheduled run reads everything` });
        break;
      }
      try {
        const r = await processItem(c, agent, company, it, perHost);
        read++;
        if (r.skipped) log.push({ at: new Date().toISOString(), msg: `${hostOf(it.url)}: ${r.skipped}` });
        for (const p of r.people) {
          if (!contactable(c.config || {}, p)) continue;
          if (await isSuppressed(c.companyId, p)) {
            log.push({ at: new Date().toISOString(), msg: `${hostOf(it.url)}: a person on your do-not-collect list was skipped` });
            continue;
          }
          rows.push(toRow(p, it));
        }
      } catch (e: any) {
        if (e instanceof HttpError && e.status === 402) throw e; // credits exhausted / not allocated
        log.push({ at: new Date().toISOString(), msg: `${hostOf(it.url)}: ${e.message}` });
      }
    }
    return { ok: true, dryRun: true, candidates: items.length, read, rows, log };
  });
}

/** Seeds today's queue (once per day from 02:00 IST, or on Run now) and applies retention. */
async function seed(c: any) {
  const cfg = c.config || {};
  const log: Log = [];
  const items = await gather(c, log, cfg.maxPerRun || 30);
  if (cfg.retentionDays > 0) {
    const cutoff = new Date(Date.now() - cfg.retentionDays * 86400_000);
    const del = await Lead.deleteMany({ companyId: c.companyId, source: "web_prospect", status: "New", createdAt: { $lt: cutoff }, "remarks.1": { $exists: false }, "attribution.0.connectorId": String(c._id) });
    if (del.deletedCount) log.push({ at: new Date().toISOString(), msg: `Retention: removed ${del.deletedCount} untouched lead(s) older than ${cfg.retentionDays} days` });
  }
  await Connector.updateOne({ _id: c._id }, { $set: { "prospect.queue": items, "prospect.seededAt": new Date(), "prospect.log": log.slice(-40), "prospect.today": { found: 0, created: 0, duplicates: 0, skipped: 0, failed: 0 } } });
  return { queued: items.length, log };
}

/** Works through the queue until the time budget is used; returns what happened. Caller holds the lock. */
async function work(c: any, deadline: number) {
  const { agent, company } = await loadModel(c);
  const { processIntake } = await import("./intake");
  return withAgentDb(String(c.companyId), agent._id, async () => {
    const fresh = await Connector.findById(c._id).select("prospect").lean<any>();
    const queue: Item[] = [...(fresh?.prospect?.queue || [])];
    const t = { found: 0, created: 0, duplicates: 0, skipped: 0, failed: 0 };
    const log: Log = [];
    const done: string[] = [];
    const perHost = new Map<string, number>();
    while (queue.length && Date.now() < deadline - 12_000) {
      const it = queue.shift()!;
      done.push(seenKey(it));
      try {
        const r = await processItem(c, agent, company, it, perHost);
        if (r.skipped) {
          t.skipped++;
          log.push({ at: new Date().toISOString(), msg: `${hostOf(it.url)}: ${r.skipped}` });
        }
        for (const p of r.people) {
          if (!contactable(c.config || {}, p)) continue;
          if (await isSuppressed(c.companyId, p)) {
            t.skipped++;
            continue; // deleted earlier — on the do-not-collect list
          }
          t.found++;
          const row = toRow(p, it);
          const res: any = await processIntake(c, { prospect: row, capturedAt: new Date().toISOString() }, `wp:${sha256(`${row.sourceUrl}|${row.phone || row.email || row.whatsapp || row.profileUrl || row.name}`).slice(0, 32)}`);
          if (res?.duplicate || res?.created === false) t.duplicates++;
          else if (res?.ok === false) t.failed++;
          else t.created++;
        }
      } catch (e: any) {
        if (e instanceof HttpError && e.status === 402) {
          queue.unshift(it);
          done.pop();
          log.push({ at: new Date().toISOString(), msg: e.message });
          break;
        }
        t.failed++;
        log.push({ at: new Date().toISOString(), msg: `${hostOf(it.url)}: ${e.message}` });
      }
    }
    const inc = Object.fromEntries(Object.entries(t).map(([k, v]) => [`prospect.today.${k}`, v]));
    await Connector.updateOne(
      { _id: c._id },
      {
        $set: { "prospect.queue": queue, "prospect.workedAt": new Date() },
        $inc: inc,
        $push: { prospectSeen: { $each: done, $slice: -3000 }, "prospect.log": { $each: log, $slice: -40 } },
      }
    );
    return { ...t, remaining: queue.length, log };
  });
}

/** 02:00 IST today (as a UTC Date). */
export function today2amIST(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 2, 0, 0) - 330 * 60_000);
  return d;
}
const due = (c: any, now = new Date()) => now >= today2amIST(now) && (!c.prospect?.seededAt || new Date(c.prospect.seededAt) < today2amIST(now));

async function withLock<T>(c: any, ms: number, fn: () => Promise<T>): Promise<T | null> {
  const now = new Date();
  const got = await Connector.findOneAndUpdate({ _id: c._id, $or: [{ "prospect.lockUntil": null }, { "prospect.lockUntil": { $lt: now } }] }, { $set: { "prospect.lockUntil": new Date(now.getTime() + ms) } }, { new: true }).lean<any>();
  if (!got) return null;
  try {
    return await fn();
  } finally {
    await Connector.updateOne({ _id: c._id }, { $set: { "prospect.lockUntil": null } });
  }
}

/** Run now: seed a fresh queue and read as much as fits; the 15-minute worker continues with the rest. */
export async function runProspectNow(c: any, budgetMs = 45_000) {
  const deadline = Date.now() + budgetMs;
  const out = await withLock(c, budgetMs + 15_000, async () => {
    const s = await seed(c);
    const w = s.queued ? await work(c, deadline) : { found: 0, created: 0, duplicates: 0, skipped: 0, failed: 0, remaining: 0, log: [] };
    return { ok: true, queued: s.queued, ...w, log: [...s.log, ...w.log] };
  });
  return out || { ok: false, error: "A run is already in progress for this connector — try again in a minute" };
}

/** The 15-minute worker: seeds connectors that are due (daily from 02:00 IST) and works through queues, fairly, within budget. */
export async function prospectWorker(budgetMs = 48_000) {
  const deadline = Date.now() + budgetMs;
  const regs = await ConnectorKey.find({ type: "web_prospect", active: true }).lean<any[]>();
  const results: any[] = [];
  const list: { reg: any; c: any }[] = [];
  for (const reg of regs) {
    const c = await runInDb(reg.db, () => Connector.findOne({ key: reg.key, active: true }).lean<any>());
    if (c && (due(c) || c.prospect?.queue?.length)) list.push({ reg, c });
  }
  list.sort((a, b) => Number(!due(a.c)) - Number(!due(b.c)) || new Date(a.c.prospect?.workedAt || 0).getTime() - new Date(b.c.prospect?.workedAt || 0).getTime());
  for (const { reg, c } of list) {
    const left = deadline - Date.now();
    if (left < 15_000) break;
    const slice = Date.now() + Math.min(left, Math.max(20_000, Math.floor(left / Math.max(1, list.length - results.length))));
    const r = await runInDb(reg.db, () =>
      withLock(c, slice - Date.now() + 15_000, async () => {
        let seeded: any = null;
        if (due(c)) seeded = await seed(c);
        const w = await work({ ...c, ...(seeded ? {} : {}) }, slice);
        return { connector: c.name, seeded: seeded?.queued, ...w, log: undefined };
      }).catch((e: any) => ({ connector: c.name, ok: false, error: e.message }))
    );
    results.push(r || { connector: c.name, busy: true });
    await runInDb(reg.db, () => Connector.updateOne({ _id: c._id }, { $set: { lastRunAt: new Date(), lastRun: { ok: !(r as any)?.error, ...(r || {}) } } }));
  }
  return { connectors: list.length, processed: results.length, results };
}

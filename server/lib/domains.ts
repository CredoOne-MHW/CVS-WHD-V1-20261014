import { Resolver } from "dns/promises";
import { baseDomain } from "./tenant";

/**
 * White-label domains.
 * - Optional Vercel API automation (VERCEL_API_TOKEN + VERCEL_PROJECT_ID [+ VERCEL_TEAM_ID]):
 *   adds the company's domain to the project, fetches the project-specific DNS
 *   recommendations and the ownership TXT challenge, and triggers verification.
 * - Without it, records fall back to Vercel's documented generic values.
 * - Live DNS lookups (Cloudflare + Google resolvers) mark each record OK / pending.
 */

export const FALLBACK_A = "76.76.21.21";
export const FALLBACK_CNAME = "cname.vercel-dns.com";

// Common multi-part public suffixes (enough for Indian + common global registrations).
const MULTI_TLDS = new Set([
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "res.in", "gov.in", "nic.in",
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "com.sg", "com.my", "co.za", "com.br", "co.jp", "com.cn", "ae.org", "co.ae",
]);

export function splitDomain(fqdn: string) {
  const parts = fqdn.toLowerCase().split(".");
  const last2 = parts.slice(-2).join(".");
  const zoneLen = MULTI_TLDS.has(last2) ? 3 : 2;
  const zone = parts.slice(-zoneLen).join(".");
  const host = parts.slice(0, -zoneLen).join(".");
  return { zone, host: host || "@", isApex: !host };
}

export const vercelConfigured = () => !!(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);

async function vercel(path: string, init: RequestInit = {}) {
  const team = process.env.VERCEL_TEAM_ID ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  const r = await fetch(`https://api.vercel.com${path}${team}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const body: any = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

const project = () => encodeURIComponent(process.env.VERCEL_PROJECT_ID!);

/** Add (or re-read) a domain on the Vercel project; returns ownership challenge + recommendations. */
export async function vercelSync(domain: string) {
  if (!vercelConfigured()) return null;
  let add = await vercel(`/v10/projects/${project()}/domains`, { method: "POST", body: JSON.stringify({ name: domain }) });
  if (!add.ok && (add.status === 400 || add.status === 409)) {
    const existing = await vercel(`/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`);
    if (existing.ok) add = existing;
  }
  if (!add.ok) return { error: add.body?.error?.message || `Vercel API ${add.status}` };
  const cfg = await vercel(`/v6/domains/${encodeURIComponent(domain)}/config?projectIdOrName=${project()}`);
  const pick = (arr: any[] | undefined) => (arr || []).slice().sort((a, b) => Number(a.rank) - Number(b.rank))[0]?.value;
  const ip = pick(cfg.body?.recommendedIPv4);
  return {
    verified: !!add.body.verified,
    verification: (add.body.verification || []).map((v: any) => ({ type: v.type, domain: v.domain, value: v.value, reason: v.reason })),
    configured: cfg.ok ? cfg.body.misconfigured === false : undefined,
    recommendedIPv4: Array.isArray(ip) ? ip[0] : ip,
    recommendedCNAME: pick(cfg.body?.recommendedCNAME),
  };
}

export async function vercelVerify(domain: string) {
  if (!vercelConfigured()) return null;
  const r = await vercel(`/v9/projects/${project()}/domains/${encodeURIComponent(domain)}/verify`, { method: "POST" });
  return { ok: r.ok, verified: !!r.body?.verified, error: r.ok ? undefined : r.body?.error?.message };
}

export async function vercelRemove(domain: string) {
  if (!vercelConfigured()) return;
  await vercel(`/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`, { method: "DELETE" }).catch(() => undefined);
}

export interface DnsRecord {
  type: "A" | "CNAME" | "TXT" | "CAA" | "NS";
  host: string; // relative to zone, as typed at the registrar
  fqdn: string;
  value: string;
  ttl: string;
  purpose: string;
  required: boolean;
  status?: "ok" | "pending" | "conflict";
  found?: string[];
}

/** Records the company (or its IT team) must add at their DNS provider. */
export function recordsFor(c: any): { zone?: string; records: DnsRecord[] } {
  const d = c.domain || {};
  const records: DnsRecord[] = [];
  if (!c.customDomain) return { records };
  const { zone, host, isApex } = splitDomain(c.customDomain);
  if (isApex) {
    records.push({ type: "A", host: "@", fqdn: c.customDomain, value: d.recommendedIPv4 || FALLBACK_A, ttl: "Auto / 3600", purpose: "Points the root domain to the app", required: true });
    records.push({ type: "CNAME", host: "www", fqdn: `www.${c.customDomain}`, value: d.recommendedCNAME || FALLBACK_CNAME, ttl: "Auto / 3600", purpose: "Optional: www version (add www as a domain too)", required: false });
  } else {
    records.push({ type: "CNAME", host, fqdn: c.customDomain, value: d.recommendedCNAME || FALLBACK_CNAME, ttl: "Auto / 3600", purpose: "Points the login subdomain to the app", required: true });
  }
  for (const v of d.verification || []) {
    const rel = v.domain.endsWith(`.${zone}`) ? v.domain.slice(0, -(zone.length + 1)) : v.domain;
    records.push({ type: (v.type || "TXT").toUpperCase(), host: rel, fqdn: v.domain, value: v.value, ttl: "Auto / 3600", purpose: "Proves ownership to the hosting platform", required: true } as DnsRecord);
  }
  records.push({ type: "CAA", host: isApex ? "@" : host, fqdn: c.customDomain, value: '0 issue "letsencrypt.org"', ttl: "Auto / 3600", purpose: "Only if the domain already has CAA records — allows the free SSL certificate", required: false });
  return { zone, records };
}

const resolvers = () => {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  return r;
};
const norm = (s: string) => s.toLowerCase().replace(/\.$/, "");
const isVercelTarget = (s: string) => /(^|\.)vercel-dns(-\d+)?\.com$/.test(norm(s));

/** Live lookup of each record. CNAME/A accept any Vercel target, not just the exact recommended one. */
export async function checkRecords(records: DnsRecord[]): Promise<DnsRecord[]> {
  const r = resolvers();
  return Promise.all(
    records.map(async (rec) => {
      try {
        if (rec.type === "CNAME") {
          const found = (await r.resolveCname(rec.fqdn).catch(() => [] as string[])).map(norm);
          const ok = found.some((f) => f === norm(rec.value) || isVercelTarget(f));
          if (!ok && !found.length) {
            const a = await r.resolve4(rec.fqdn).catch(() => [] as string[]);
            return { ...rec, found: a, status: a.length ? "conflict" : "pending" } as DnsRecord;
          }
          return { ...rec, found, status: ok ? "ok" : "conflict" } as DnsRecord;
        }
        if (rec.type === "A") {
          const found = await r.resolve4(rec.fqdn).catch(() => [] as string[]);
          const ok = found.includes(rec.value) || found.includes(FALLBACK_A);
          return { ...rec, found, status: ok ? (found.length > 1 ? "conflict" : "ok") : found.length ? "conflict" : "pending" } as DnsRecord;
        }
        if (rec.type === "TXT") {
          const found = (await r.resolveTxt(rec.fqdn).catch(() => [] as string[][])).map((x) => x.join(""));
          return { ...rec, found, status: found.includes(rec.value) ? "ok" : "pending" } as DnsRecord;
        }
        if (rec.type === "CAA") {
          const found = (await r.resolveCaa(rec.fqdn).catch(() => [] as any[])).map((x: any) => `${x.critical} ${x.issue ? "issue" : x.issuewild ? "issuewild" : "iodef"} "${x.issue || x.issuewild || x.iodef}"`);
          // no CAA at all = fine
          return { ...rec, found, status: !found.length || found.some((f) => f.includes("letsencrypt.org")) ? "ok" : "conflict" } as DnsRecord;
        }
        return rec;
      } catch {
        return { ...rec, status: "pending" } as DnsRecord;
      }
    })
  );
}

/** Records the platform owner sets ONCE for <slug>.<base> to work (shown in Knowledgebase). */
export function platformRecords() {
  const base = baseDomain() || "mhw.credovation.tech";
  const { zone, host } = splitDomain(base);
  return {
    base,
    zone,
    delegation: [
      { type: "NS", host, fqdn: base, value: "ns1.vercel-dns.com", ttl: "3600", purpose: "Delegate the base subdomain to Vercel DNS (needed for wildcard SSL)", required: true },
      { type: "NS", host, fqdn: base, value: "ns2.vercel-dns.com", ttl: "3600", purpose: "Second nameserver", required: true },
    ] as DnsRecord[],
    cnameOnly: [
      { type: "CNAME", host, fqdn: base, value: FALLBACK_CNAME, ttl: "Auto", purpose: "Super Admin console only (no wildcard tenants)", required: false },
    ] as DnsRecord[],
  };
}

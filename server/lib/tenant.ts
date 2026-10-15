import type { Request } from "express";
import { Company } from "../models";

/**
 * Host → tenant.
 *  - APP_BASE_DOMAIN itself, *.vercel.app, localhost  → platform (Super Admin login)
 *  - <slug>.<APP_BASE_DOMAIN>                         → that company
 *  - any other host                                    → company whose customDomain matches
 */
const cleanHost = (v: string) =>
  v.trim().replace(/^["']|["']$/g, "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");

/** Tolerates "https://", trailing slashes, quotes and spaces — common copy-paste mistakes in Vercel env. */
export const baseDomain = () => cleanHost(process.env.APP_BASE_DOMAIN || "");

/** Extra addresses that always show the platform (Super Admin) login, comma-separated. */
const extraPlatformHosts = () => (process.env.PLATFORM_HOSTS || "").split(",").map(cleanHost).filter(Boolean);

export function requestHost(req: Request) {
  const raw = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
  return raw.replace(/:\d+$/, "");
}

export function isPlatformHost(host: string) {
  const base = baseDomain();
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) return true;
  if (base && (host === base || host === `www.${base}`)) return true;
  return extraPlatformHosts().includes(host);
}

/**
 * platform → Super Admin login · company → that company · unknown → nothing mapped here.
 * If APP_BASE_DOMAIN isn't configured, an address that matches no company falls back to the
 * platform login instead of a dead end (so a fresh deployment always shows a login).
 */
export async function resolveHost(host: string): Promise<{ kind: "platform" } | { kind: "company"; company: any } | { kind: "unknown" }> {
  if (isPlatformHost(host)) return { kind: "platform" };
  const company = await companyForHost(host);
  if (company) return { kind: "company", company };
  const base = baseDomain();
  if (!base) return { kind: "platform" };
  return { kind: "unknown" };
}

const cache = new Map<string, { at: number; company: any | null }>();
const TTL = 60_000;
export const clearTenantCache = () => cache.clear();

export async function companyForHost(host: string): Promise<any | null> {
  if (isPlatformHost(host)) return null;
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.company;
  const base = baseDomain();
  let q: any;
  if (base && host.endsWith(`.${base}`)) {
    const slug = host.slice(0, -(base.length + 1));
    if (slug.includes(".")) return null; // only one level of subdomain
    q = { slug };
  } else q = { customDomain: host };
  const company = await Company.findOne({ ...q, deletedAt: null }).lean();
  cache.set(host, { at: Date.now(), company });
  return company;
}

export function tenantUrls(c: { slug?: string; customDomain?: string }) {
  const base = baseDomain();
  return {
    platformUrl: c.slug && base ? `https://${c.slug}.${base}` : undefined,
    customUrl: c.customDomain ? `https://${c.customDomain}` : undefined,
  };
}

/** Public branding payload (safe to expose on the login page). */
export function publicBranding(c: any) {
  const b = c.branding || {};
  const v = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  const asset = (kind: string, key?: string) => (key ? `/api/public/brand-asset/${c._id}/${kind}?v=${v}` : undefined);
  return {
    kind: "company" as const,
    companyId: String(c._id),
    name: c.name,
    shortName: b.shortName || c.name,
    tagline: b.tagline || "",
    headline: b.headline || "Every enquiry, captured. Every follow-up, on time.",
    subheadline: b.subheadline || "Website, WhatsApp, Meta and Google ads, calls and walk-ins land in one pipeline — qualified, routed and tracked to conversion.",
    footerText: b.footerText || "",
    themeColor: b.themeColor || "#2f5c24",
    accentColor: b.accentColor || "#d9b52a",
    loginLayout: b.loginLayout || "split",
    logoUrl: asset("logo", b.logoKey),
    bannerUrl: asset("banner", b.bannerKey),
    faviconUrl: asset("favicon", b.faviconKey) || asset("logo", b.logoKey),
    supportEmail: b.supportEmail,
    supportPhone: b.supportPhone,
    active: c.status === "active",
  };
}

export function platformBranding() {
  return {
    kind: "platform" as const,
    name: process.env.PLATFORM_NAME || "CredoOne",
    shortName: process.env.PLATFORM_NAME || "CredoOne",
    tagline: process.env.PLATFORM_TAGLINE || "Lead Management Console",
    headline: "Every lead. One console.",
    subheadline: "Capture enquiries from every channel, qualify them automatically and follow up on WhatsApp — for every company you run, under their own brand.",
    footerText: process.env.PLATFORM_FOOTER || `© ${new Date().getFullYear()} Credovation Solutions Pvt Ltd`,
    themeColor: process.env.PLATFORM_THEME || "#2b2d72",
    accentColor: process.env.PLATFORM_ACCENT || "#6c63ff",
    logoUrl: process.env.NEXT_PUBLIC_PLATFORM_LOGO || "/credoone-logo.png",
  };
}

import type { Request, Response, NextFunction } from "express";
import { Company } from "../models";
import { cached, invalidate } from "./cache";

/**
 * Host → tenant, resolved PER REQUEST so one codebase serves prod and dev side by side:
 *   mhw.credovation.tech            → platform (prod)      <slug>.mhw.credovation.tech     → company
 *   dev-mhw.credovation.tech        → platform (dev)       <slug>.dev-mhw.credovation.tech → company
 *   *.vercel.app, localhost         → platform
 *   any other host                  → company whose customDomain matches
 *
 * APP_BASE_DOMAIN accepts a comma-separated list (e.g. "mhw.credovation.tech,dev-mhw.credovation.tech").
 * If the current address isn't in the list (typical when Vercel env vars are scoped to Production only),
 * the base is auto-detected from the address itself, so a Preview/dev deployment still works.
 */
const cleanHost = (v: string) =>
  v.trim().replace(/^["']|["']$/g, "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");

export const configuredBases = () =>
  [...(process.env.APP_BASE_DOMAIN || "").split(","), ...(process.env.APP_BASE_DOMAINS || "").split(",")].map(cleanHost).filter(Boolean);

const extraPlatformHosts = () => (process.env.PLATFORM_HOSTS || "").split(",").map(cleanHost).filter(Boolean);

import { als } from "./context";

/** Express middleware: opens the request context. */
export function hostContext(req: Request, _res: Response, next: NextFunction) {
  als.run({ host: requestHost(req) }, next);
}

const matchConfigured = (host: string) => configuredBases().find((b) => host === b || host === `www.${b}` || host.endsWith(`.${b}`));

/** Base domain for the current request (falls back to the first configured one outside a request). */
export function baseDomain(): string {
  const ctx = als.getStore();
  if (ctx?.base) return ctx.base;
  if (ctx?.host) {
    const m = matchConfigured(ctx.host);
    if (m) return m;
  }
  return configuredBases()[0] || "";
}
export const baseSource = () => als.getStore()?.baseSource || (configuredBases().length ? "env" : "auto");

export function requestHost(req: Request) {
  const raw = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
  return raw.replace(/:\d+$/, "");
}

export function isPlatformHost(host: string) {
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) return true;
  if (extraPlatformHosts().includes(host)) return true;
  return configuredBases().some((b) => host === b || host === `www.${b}`);
}

const setCtx = (base: string, source: "env" | "auto") => {
  const ctx = als.getStore();
  if (ctx) {
    ctx.base = base;
    ctx.baseSource = source;
  }
};

const findCompany = (q: any) => cached(`tenant:${JSON.stringify(q)}`, 60, () => Company.findOne({ ...q, deletedAt: null }).lean());

/** platform → Super Admin login · company → that company · unknown → an unused sub-domain of our base. */
export async function resolveHost(host: string): Promise<{ kind: "platform" } | { kind: "company"; company: any } | { kind: "unknown" }> {
  // support.<company address> is that company's client support portal
  if (host.startsWith("support.") && host.split(".").length >= 3) host = host.slice("support.".length);
  // 1. configured base or a sub-domain of it
  const m = matchConfigured(host);
  if (m) {
    setCtx(m, "env");
    if (host === m || host === `www.${m}`) return { kind: "platform" };
    const slug = host.slice(0, -(m.length + 1));
    if (!slug.includes(".")) {
      const company = await findCompany({ slug });
      if (company) return { kind: "company", company };
    }
    return { kind: "unknown" }; // <unknown>.<our base>
  }
  if (isPlatformHost(host)) return { kind: "platform" };
  // 2. a company's own domain
  const custom = await findCompany({ customDomain: host });
  if (custom) {
    setCtx(configuredBases()[0] || "", "env");
    return { kind: "company", company: custom };
  }
  // 3. auto-detect <slug>.<some base> when the base isn't configured for this environment
  const labels = host.split(".");
  if (labels.length >= 4) {
    const company = await findCompany({ slug: labels[0] });
    if (company) {
      setCtx(labels.slice(1).join("."), "auto");
      return { kind: "company", company };
    }
  }
  // 4. unknown address → treat it as this environment's platform address
  setCtx(host, "auto");
  return { kind: "platform" };
}

/** Kept for callers that only need the company. */
export async function companyForHost(host: string) {
  const t = await resolveHost(host);
  return t.kind === "company" ? t.company : null;
}

export const clearTenantCache = () => invalidate("tenant:");

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
    loginTemplate: b.loginTemplate || (b.loginLayout === "banner" ? "photo" : b.loginLayout === "centered" ? "spotlight" : "classic"),
    logoUrl: asset("logo", b.logoKey),
    bannerUrl: asset("banner", b.bannerKey),
    faviconUrl: asset("favicon", b.faviconKey) || asset("logo", b.logoKey),
    supportEmail: b.supportEmail,
    supportPhone: b.supportPhone,
    active: c.status === "active",
  };
}

/* Platform login look, editable by the Super Admin (Settings › Platform branding); env vars are the defaults. */
let platformOverride: any = {};
let platformLoadedAt = 0;
/** Refreshes the Super Admin's platform branding at most once a minute per instance (call before platformBranding()). */
export async function loadPlatformBranding(force = false) {
  if (!force && Date.now() - platformLoadedAt < 60_000) return;
  try {
    const { PlatformSetting } = await import("../models");
    const doc = await PlatformSetting.findById("platform_branding").lean<any>();
    platformOverride = doc?.value || {};
    platformLoadedAt = Date.now();
  } catch {
    /* keep the last known value */
  }
}
export const setPlatformBranding = (v: any) => {
  platformOverride = v || {};
  platformLoadedAt = Date.now();
};

export function platformBranding() {
  const o = platformOverride || {};
  const pick = (k: string, d: string) => (typeof o[k] === "string" && o[k].trim() ? o[k] : d);
  return {
    kind: "platform" as const,
    name: process.env.PLATFORM_NAME || "CredoOne",
    shortName: process.env.PLATFORM_NAME || "CredoOne",
    tagline: pick("tagline", process.env.PLATFORM_TAGLINE || "Lead Management Console"),
    headline: pick("headline", "Every lead. One console."),
    subheadline: pick("subheadline", "Capture enquiries from every channel, qualify them automatically and follow up on WhatsApp — for every company you run, under their own brand."),
    footerText: pick("footerText", process.env.PLATFORM_FOOTER || `© ${new Date().getFullYear()} Credovation Solutions Pvt Ltd`),
    themeColor: pick("themeColor", process.env.PLATFORM_THEME || "#2b2d72"),
    accentColor: pick("accentColor", process.env.PLATFORM_ACCENT || "#6c63ff"),
    loginTemplate: pick("loginTemplate", "aurora"),
    logoUrl: process.env.NEXT_PUBLIC_PLATFORM_LOGO || "/credoone-logo.png",
  };
}

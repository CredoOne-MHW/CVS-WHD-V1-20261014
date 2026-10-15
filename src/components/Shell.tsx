"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, LogOut, ChevronRight, ChevronDown, ShieldAlert, Globe, X } from "lucide-react";
import { icon } from "./icons";
import { Assistant } from "./Assistant";
import { BillingAlert } from "./BillingAlert";
import { ErrorBoundary, InlineError as InlineErrorCard } from "./ErrorBoundary";
import { installGlobalErrorHandlers } from "@/lib/clientErrors";
import { api } from "@/lib/api";
import { Spinner } from "./ui";
import type { PermMap } from "@shared/constants";
import { applyTheme, setFavicon } from "@shared/theme";

export interface Branding {
  kind: "platform" | "company";
  name: string;
  shortName: string;
  tagline?: string;
  themeColor: string;
  accentColor: string;
  logoUrl?: string;
  faviconUrl?: string;
  footerText?: string;
  platformUrl?: string;
  customUrl?: string;
}
export interface Me {
  userId: string;
  scope: "super" | "company";
  companyId?: string;
  companyName?: string;
  plan?: string;
  name: string;
  email: string;
  isOwner: boolean;
  impersonatedBy?: string;
  perms: PermMap;
  nav: { key: string; label: string; group: string; path: string; icon: string }[];
  branding: Branding;
}

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const usePerm = (module: string) => useMe()?.perms?.[module] || { create: false, read: false, update: false, delete: false };

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

function BrandMark({ b, size = 40 }: { b: Branding; size?: number }) {
  if (b.logoUrl)
    return (
      <span className="grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 ring-1 ring-white/20" style={{ width: size, height: size }}>
        <img src={b.logoUrl} alt="" className="h-full w-full object-contain" />
      </span>
    );
  return (
    <span className="grid shrink-0 place-items-center rounded-xl bg-white/15 font-extrabold text-white ring-1 ring-white/20" style={{ width: size, height: size }}>
      {initials(b.shortName || b.name)}
    </span>
  );
}

export default function Shell({ scope, children }: { scope: "super" | "company"; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [expanded, setExpanded] = useState(false); // desktop: full sidebar vs icon rail
  const [drawer, setDrawer] = useState(false); // mobile drawer
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const path = usePathname() || "";
  const router = useRouter();

  useEffect(() => {
    installGlobalErrorHandlers();
    try {
      setExpanded(localStorage.getItem("lms_nav") === "open");
    } catch {}
    api<Me>("/auth/me")
      .then((m) => {
        if (m.scope !== scope) return router.replace(m.scope === "super" ? "/sa" : "/app");
        applyTheme(m.branding?.themeColor, m.branding?.accentColor);
        setFavicon(m.branding?.faviconUrl || m.branding?.logoUrl, { name: m.branding?.shortName || m.companyName || "CredoOne", color: m.branding?.themeColor });
        document.title = `${m.branding?.shortName || "Leads"} · Lead Management`;
        setMe(m);
      })
      .catch(() => router.replace("/login"));
  }, [scope, router]);
  useEffect(() => {
    setDrawer(false);
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!me)
    return (
      <div className="flex min-h-screen items-center justify-center text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const isActive = (p: string) => (p === "/sa" || p === "/app" ? path === p : path.startsWith(p));
  const current = me.nav.find((n) => isActive(n.path));
  const b = me.branding;
  const toggle = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      const next = !expanded;
      setExpanded(next);
      try {
        localStorage.setItem("lms_nav", next ? "open" : "rail");
      } catch {}
    } else setDrawer(!drawer);
  };
  const signOut = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  /** `full` = labels visible (expanded desktop or mobile drawer); otherwise an icon rail with tooltips. */
  const nav = (full: boolean) => (
    <nav aria-label="Main menu" className="flex h-full flex-col bg-gradient-to-b from-hive-900 via-hive-900 to-hive-950 text-white">
      <div className={`flex items-center gap-3 pb-6 pt-5 ${full ? "px-5" : "justify-center px-0"}`}>
        <BrandMark b={b} size={full ? 42 : 40} />
        {full && (
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold leading-tight">{b.shortName || b.name}</p>
            <p className="eyebrow mt-0.5 truncate text-honey-300">{scope === "super" ? b.tagline || "Super Admin" : `${me.plan} plan`}</p>
          </div>
        )}
      </div>
      <div className={`flex-1 space-y-6 overflow-y-auto overflow-x-hidden pb-6 ${full ? "px-3" : "px-2.5"}`}>
        {["Main", "Settings"].map((g) => {
          const items = me.nav.filter((n) => n.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              {full ? <p className="eyebrow px-3 pb-2 text-white/45">{g}</p> : <div className="mx-auto mb-2 h-px w-8 bg-white/15" aria-hidden />}
              <ul className="space-y-0.5">
                {items.map((n) => {
                  const Icon = icon(n.icon);
                  const active = isActive(n.path);
                  return (
                    <li key={n.key} className="group/item relative">
                      <Link
                        href={n.path}
                        prefetch
                        aria-current={active ? "page" : undefined}
                        aria-label={full ? undefined : n.label}
                        className={`group flex items-center rounded-xl text-[13.5px] font-semibold transition ${full ? "gap-3 px-3 py-2.5" : "h-11 w-11 justify-center"} ${active ? "bg-white text-hive-900 shadow-lg shadow-black/10" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
                      >
                        <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-hive-700" : "text-white/60 group-hover:text-white"}`} />
                        {full && n.label}
                      </Link>
                      {!full && (
                        <span role="tooltip" className="pointer-events-none absolute left-[54px] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lift transition group-hover/item:opacity-100">
                          {n.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {full && scope === "company" && (b.customUrl || b.platformUrl) && (
        <a href={b.customUrl || b.platformUrl} target="_blank" rel="noreferrer" className="mx-3 mb-3 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-white/85 hover:bg-white/15">
          <Globe className="h-4 w-4 shrink-0" />
          <span className="truncate">{(b.customUrl || b.platformUrl)!.replace("https://", "")}</span>
        </a>
      )}
      {full && <p className="px-5 pb-5 text-[11px] text-white/40">{scope === "company" ? "Powered by CredoOne" : b.footerText}</p>}
    </nav>
  );

  return (
    <MeCtx.Provider value={me}>
      <div className={`min-h-screen transition-[padding] duration-300 ${expanded ? "lg:pl-[264px]" : "lg:pl-[76px]"}`}>
        <aside className={`fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-300 lg:block ${expanded ? "w-[264px]" : "w-[76px]"}`}>{nav(expanded)}</aside>
        {drawer && (
          <div className="fixed inset-0 z-40 bg-ink-900/50 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)}>
            <aside className="relative h-full w-[280px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
              {nav(true)}
            </aside>
          </div>
        )}

        {me.impersonatedBy && (
          <div className="flex flex-wrap items-center justify-center gap-3 bg-honey-300 px-4 py-2 text-sm font-semibold text-ink-900">
            <ShieldAlert className="h-4 w-4" />
            Force-logged in as {me.companyName} by {me.impersonatedBy}. Actions are logged.
            <button
              className="rounded-lg bg-ink-900 px-3 py-1 text-xs text-white"
              onClick={async () => {
                const r = await api<{ redirect: string }>("/auth/impersonate-exit", { method: "POST" });
                window.location.href = r.redirect;
              }}
            >
              Return to Super Admin
            </button>
          </div>
        )}

        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-400/10 bg-white/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <button onClick={toggle} className="btn-ghost -ml-1.5 h-10 w-10 p-0" aria-label={expanded ? "Collapse menu" : "Open menu"} aria-expanded={expanded || drawer}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-[13px] text-ink-500">
              <span className="truncate">{scope === "super" ? "Super Admin" : me.companyName}</span>
              {current && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-semibold text-ink-900">{current.label}</span>
                </>
              )}
            </p>
          </div>
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenu(!menu)} className="flex items-center gap-2.5 rounded-xl py-1.5 pl-1.5 pr-2.5 hover:bg-hive-50" aria-haspopup="menu" aria-expanded={menu}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-hive-600 to-hive-800 text-xs font-bold text-white">{initials(me.name)}</span>
              <span className="hidden text-left sm:block">
                <span className="block max-w-[160px] truncate text-[13px] font-semibold leading-tight text-ink-900">{me.name}</span>
                <span className="block max-w-[160px] truncate text-[11.5px] text-ink-500">{me.isOwner ? (scope === "super" ? "Owner" : "Company admin") : "Team member"}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-ink-400" />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-ink-400/15 bg-white py-1.5 shadow-lift">
                <div className="border-b border-ink-400/10 px-4 pb-2.5 pt-1.5">
                  <p className="truncate text-sm font-semibold">{me.name}</p>
                  <p className="truncate text-xs text-ink-500">{me.email}</p>
                </div>
                <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1480px] px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
          {current ? children : <div className="card p-10 text-center text-ink-500">Your plan or role does not include this module.</div>}
        </main>
        {scope === "company" && (
          <ErrorBoundary where="billing-alert" fallback={() => null}>
            <BillingAlert belowBanner={!!me.impersonatedBy} />
          </ErrorBoundary>
        )}
        {scope === "company" && (
          <ErrorBoundary
            where="assistant"
            fallback={(err, reset) => (
              <div className="fixed bottom-5 right-5 z-40 w-[min(360px,calc(100vw-40px))] sm:bottom-7 sm:right-7">
                <InlineErrorCard error={err} onReset={reset} />
              </div>
            )}
          >
            <Assistant companyName={me.companyName} />
          </ErrorBoundary>
        )}
      </div>
    </MeCtx.Provider>
  );
}

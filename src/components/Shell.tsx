"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { Spinner } from "./ui";
import type { PermMap } from "@shared/constants";

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
}

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const usePerm = (module: string) => useMe()?.perms?.[module] || { create: false, read: false, update: false, delete: false };

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "Wellness Hive";
const LOGO = process.env.NEXT_PUBLIC_BRAND_LOGO || "/wellness-hive-logo.jpeg";

export default function Shell({ scope, children }: { scope: "super" | "company"; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const path = usePathname() || "";
  const router = useRouter();

  useEffect(() => {
    api<Me>("/auth/me")
      .then((m) => {
        if (m.scope !== scope) router.replace(m.scope === "super" ? "/sa" : "/app");
        else setMe(m);
      })
      .catch(() => router.replace("/login"));
  }, [scope, router]);
  useEffect(() => setOpen(false), [path]);

  if (!me)
    return (
      <div className="flex min-h-screen items-center justify-center text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const allowed = me.nav.find((n) => (n.path === "/sa" || n.path === "/app" ? path === n.path : path.startsWith(n.path)));
  const groups = ["Main", "Settings"];

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <img src={LOGO} alt="" className="h-11 w-11 rounded-full border border-hive-100 bg-white object-cover" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-extrabold text-hive-800">{scope === "super" ? BRAND : me.companyName}</p>
          <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-honey-700">{scope === "super" ? "Super Admin" : `${me.plan} plan`}</p>
        </div>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {groups.map((g) => {
          const items = me.nav.filter((n) => n.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[.14em] text-ink-400">{g}</p>
              <ul className="space-y-0.5">
                {items.map((n) => {
                  const Icon = (Icons as any)[n.icon] || Icons.Circle;
                  const active = n.path === "/sa" || n.path === "/app" ? path === n.path : path.startsWith(n.path);
                  return (
                    <li key={n.key}>
                      <Link href={n.path} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-hive-700 text-white shadow-sm" : "text-ink-700 hover:bg-hive-50"}`}>
                        <Icon className="h-[18px] w-[18px]" />
                        {n.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-ink-400/15 p-4">
        <p className="truncate text-sm font-semibold text-ink-900">{me.name}</p>
        <p className="truncate text-xs text-ink-500">{me.email}</p>
        <button
          className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink-500 hover:text-red-600"
          onClick={async () => {
            await api("/auth/logout", { method: "POST" });
            router.replace("/login");
          }}
        >
          <Icons.LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <MeCtx.Provider value={me}>
      <div className="min-h-screen lg:pl-64">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-ink-400/15 bg-white lg:block">{nav}</aside>
        {open && (
          <div className="fixed inset-0 z-40 bg-ink-900/40 lg:hidden" onClick={() => setOpen(false)}>
            <aside className="h-full w-72 bg-white" onClick={(e) => e.stopPropagation()}>
              {nav}
            </aside>
          </div>
        )}
        {me.impersonatedBy && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-center gap-3 bg-honey-300 px-4 py-2 text-sm font-semibold text-ink-900">
            <Icons.ShieldAlert className="h-4 w-4" />
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
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-ink-400/15 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="btn-ghost" aria-label="Open menu">
            <Icons.Menu className="h-5 w-5" />
          </button>
          <img src={LOGO} alt="" className="h-8 w-8 rounded-full" />
          <span className="font-bold text-hive-800">{scope === "super" ? BRAND : me.companyName}</span>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {allowed ? children : <div className="card p-10 text-center text-ink-500">Your plan or role does not include this module.</div>}
        </main>
      </div>
    </MeCtx.Provider>
  );
}

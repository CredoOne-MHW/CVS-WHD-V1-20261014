"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellRing, X } from "lucide-react";
import { api } from "@/lib/api";

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

/**
 * Top-middle flash for the company console: Over Due / Expired (red, pulsing) or a due-soon reminder (amber, only when the
 * plan enables web-app reminders). One tiny request on load and every 10 minutes; the server caches it per company.
 */
export function BillingAlert({ belowBanner }: { belowBanner?: boolean }) {
  const [a, setA] = useState<any>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api("/co/billing-alert", { fresh: true })
        .then((x) => {
          if (alive) setA(x);
        })
        .catch(() => undefined);
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (!a) return;
    try {
      setHidden(sessionStorage.getItem("lms_bill_hide") === `${a.kind}:${a.dueDate}`);
    } catch {}
  }, [a?.kind, a?.dueDate]);
  if (!a || hidden) return null;

  const late = a.kind === "overdue" || a.kind === "expired";
  const text =
    a.kind === "expired"
      ? `Subscription expired — ${inr(a.amount)} was due on ${fmt(a.dueDate)}.`
      : a.kind === "overdue"
        ? `Payment over due — ${inr(a.amount)} was due on ${fmt(a.dueDate)} (${-a.daysLeft} day${a.daysLeft === -1 ? "" : "s"} ago).`
        : `Subscription payment of ${inr(a.amount)} is due ${a.daysLeft <= 0 ? "today" : `in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}`} (${fmt(a.dueDate)}).`;

  return (
    <div className={`pointer-events-none fixed inset-x-0 z-[45] flex justify-center px-3 ${belowBanner ? "top-14" : "top-3"}`} role={late ? "alert" : "status"}>
      <div
        className={`pointer-events-auto flex max-w-[680px] items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-xl ring-1 ${
          late ? "animate-[billflash_1.6s_ease-in-out_infinite] bg-red-600 text-white ring-red-700" : "bg-amber-50 text-amber-900 ring-amber-200"
        }`}
      >
        {late ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <BellRing className="h-4 w-4 shrink-0" />}
        <span>{text}</span>
        <Link href="/app/settings/subscription" className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${late ? "bg-white/20 hover:bg-white/30" : "bg-amber-200/70 hover:bg-amber-200"}`}>
          View
        </Link>
        <button
          type="button"
          aria-label="Hide for this session"
          onClick={() => {
            setHidden(true);
            try {
              sessionStorage.setItem("lms_bill_hide", `${a.kind}:${a.dueDate}`);
            } catch {}
          }}
          className="shrink-0 rounded-lg p-1 opacity-80 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

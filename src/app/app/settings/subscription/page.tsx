"use client";
import { useEffect, useState } from "react";
import { CalendarClock, BellRing, Bot, Receipt, AlertTriangle } from "lucide-react";
import { api, qs } from "@/lib/api";
import { PageHeader, Badge, Empty, Spinner, Pager } from "@/components/ui";
import { Tabs } from "@/components/Logs";
import { freqLabel, PAYMENT_STATUSES } from "@shared/billing";

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmt = (d?: string | Date) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const STYLE: Record<string, string> = {
  paid: "bg-hive-100 text-hive-800 ring-hive-200",
  unpaid: "bg-amber-50 text-amber-800 ring-amber-200",
  overdue: "bg-red-50 text-red-700 ring-red-200",
  expired: "bg-ink-400/10 text-ink-700 ring-ink-400/30",
};
const Pill = ({ s }: { s: string }) => <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${STYLE[s] || STYLE.unpaid}`}>{PAYMENT_STATUSES.find((x) => x.key === s)?.label || s}</span>;

export default function CompanySubscription() {
  const [tab, setTab] = useState<"current" | "history">("current");
  return (
    <>
      <PageHeader title="Subscription" subtitle="Your plan, billing cycle, AI model credits and payment history" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "current", label: "Current Plan" }, { key: "history", label: "History" }]} />
      {tab === "current" ? <Current /> : <History />}
    </>
  );
}

function Current() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/co/subscription", { fresh: true }).then(setD).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>;
  if (!d)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  const c = d.current;
  const late = c && (c.status === "overdue" || c.status === "expired");
  const progress = c ? Math.max(0, Math.min(100, ((Date.now() - new Date(c.periodStart).getTime()) / (new Date(c.periodEnd).getTime() - new Date(c.periodStart).getTime())) * 100)) : 0;

  return (
    <div className="space-y-5">
      {d.outstanding.count > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <b>{d.outstanding.count} payment(s) pending</b> — {inr(d.outstanding.amount)} in total. Please contact your account manager to settle.
          </p>
        </div>
      )}
      {!d.subscription ? (
        <div className="card">
          <Empty title="No subscription yet" hint="Your platform administrator hasn't assigned a subscription plan to your company." />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className={`relative overflow-hidden rounded-3xl p-6 text-white ${late ? "bg-gradient-to-br from-red-700 via-red-800 to-red-950" : "bg-gradient-to-br from-hive-800 via-hive-900 to-hive-950"}`}>
            <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5" />
            <div aria-hidden className="absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/5" />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">Current plan</p>
              <p className="mt-1 text-3xl font-extrabold tracking-tight">{d.subscription.planName}</p>
              <p className="mt-1 text-sm text-white/70">
                {inr(d.subscription.amount)} · {freqLabel(d.subscription.frequency)} · since {fmt(d.subscription.startDate)}
              </p>
              {c && (
                <>
                  <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-white/60">Amount due this cycle</p>
                      <p className="text-4xl font-extrabold">{inr(c.total)}</p>
                    </div>
                    <div className="text-right">
                      <Pill s={c.status} />
                      <p className="mt-1.5 text-sm text-white/80">
                        {c.daysLeft < 0 ? `${-c.daysLeft} day(s) past due` : c.daysLeft === 0 ? "Due today" : `Due in ${c.daysLeft} day(s)`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex justify-between text-[11px] text-white/60">
                      <span>{fmt(c.periodStart)}</span>
                      <span>Expiry {fmt(c.periodEnd)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/15">
                      <span className="block h-full rounded-full bg-gradient-to-r from-honey-300 to-honey-500" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="card divide-y divide-ink-400/10">
            <p className="flex items-center gap-2 px-5 py-4 text-sm font-bold">
              <Receipt className="h-4 w-4 text-hive-700" /> This cycle
            </p>
            {c ? (
              <dl className="space-y-2.5 px-5 py-4 text-sm">
                <Row l="System (plan) amount" v={inr(c.systemAmount)} />
                <Row l={`AI agent usage${c.aiLive ? " (so far)" : ""}`} v={inr(c.aiAmount)} />
                <Row l="Discount applied" v={c.discount ? `− ${inr(c.discount)}` : "—"} />
                <div className="border-t border-dashed border-ink-400/20 pt-2.5">
                  <Row l={<b>Total</b>} v={<b className="text-base">{inr(c.total)}</b>} />
                </div>
              </dl>
            ) : (
              <p className="px-5 py-4 text-sm text-ink-400">The first cycle starts on {fmt(d.subscription.startDate)}.</p>
            )}
            {d.reminders && (
              <p className="flex items-start gap-2 px-5 py-3 text-xs text-ink-500">
                <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hive-600" />
                Reminders {d.reminders.days?.length ? `${[...d.reminders.days].sort((a: number, b: number) => b - a).join(", ")} day(s) before the due date` : "off"}
                {d.reminders.whatsApp ? " on WhatsApp" : ""}
                {d.reminders.webApp ? " and here" : ""}.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <p className="flex items-center gap-2 border-b border-ink-400/10 px-5 py-4 text-sm font-bold">
          <Bot className="h-4 w-4 text-hive-700" /> AI model credits
        </p>
        {d.aiAllocations.length ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {d.aiAllocations.map((a: any) => {
              const pct = a.credits ? Math.max(0, Math.min(100, (a.remaining / a.credits) * 100)) : 0;
              return (
                <div key={a.model} className="rounded-2xl border border-ink-400/12 p-4">
                  <p className="font-semibold">{a.model}</p>
                  <p className="mono text-xs text-ink-400">{a.llmVersion}</p>
                  <p className="mt-3 text-2xl font-extrabold tabular-nums">
                    {a.remaining.toLocaleString("en-IN")} <span className="text-sm font-medium text-ink-400">/ {a.credits.toLocaleString("en-IN")} credits</span>
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-400/15">
                    <span className={`block h-full ${pct > 10 ? "bg-hive-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-500">
                    <CalendarClock className="h-3.5 w-3.5" /> {freqLabel(a.frequency)} · renews {fmt(a.renewalDate)} · ₹{a.rate}/credit
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-400">No AI models allocated to your company.</p>
        )}
      </div>
    </div>
  );
}

const Row = ({ l, v }: { l: any; v: any }) => (
  <div className="flex items-center justify-between gap-4">
    <dt className="text-ink-500">{l}</dt>
    <dd className="tabular-nums text-ink-900">{v}</dd>
  </div>
);

function History() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    setD(null);
    api(`/co/subscription/history${qs({ status, page })}`, { fresh: true }).then(setD);
  }, [status, page]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {[["", "All"], ...PAYMENT_STATUSES.map((s) => [s.key, s.label])].map(([k, l]) => (
          <button key={k} onClick={() => (setPage(1), setStatus(k))} className={`rounded-full px-4 py-1.5 text-sm font-semibold ring-1 ${status === k ? "bg-hive-700 text-white ring-hive-700" : "bg-white text-ink-700 ring-ink-400/20 hover:bg-hive-50"}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              {["Plan", "Start date", "Expiry date", "System amount", "AI agent", "Discount", "Total", "Payment status"].map((h) => (
                <th key={h} className={`th ${["System amount", "AI agent", "Discount", "Total"].includes(h) ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d?.items.map((r: any) => (
              <tr key={r._id} className="hover:bg-hive-50/40">
                <td className="td font-semibold">
                  {r.planName} <span className="block text-xs font-normal text-ink-400">{freqLabel(r.frequency)}</span>
                </td>
                <td className="td whitespace-nowrap">{fmt(r.periodStart)}</td>
                <td className="td whitespace-nowrap">{fmt(r.periodEnd)}</td>
                <td className="td text-right tabular-nums">{inr(r.systemAmount)}</td>
                <td className="td text-right tabular-nums">{inr(r.aiAmount)}</td>
                <td className="td text-right tabular-nums">{r.discount ? `− ${inr(r.discount)}` : "—"}</td>
                <td className="td text-right tabular-nums font-bold">{inr(r.total)}</td>
                <td className="td">
                  <Pill s={r.status} />
                  {r.paidAt && <span className="block text-[11px] text-ink-400">paid {fmt(r.paidAt)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!d && (
          <div className="flex justify-center py-16 text-hive-700">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {d && !d.items.length && <Empty title="No billing history" hint="Payment status of every subscription cycle will appear here." />}
        {d && d.total > d.limit && (
          <div className="border-t border-ink-400/10 px-4 py-2">
            <Pager page={d.page} limit={d.limit} total={d.total} onPage={setPage} />
          </div>
        )}
      </div>
    </>
  );
}

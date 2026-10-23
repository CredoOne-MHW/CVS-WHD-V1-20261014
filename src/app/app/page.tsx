"use client";
/**
 * Company dashboard — the whole organisation at a glance.
 * Health score → alerts to check now → the numbers that matter (each vs the previous period) → AI recommendations →
 * what goes well / not well → trends and breakdowns → area health (clients & money, support, WhatsApp, AI).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, Info, MessageCircle, Minus, RefreshCw, Sparkles, TrendingDown, TrendingUp, Wand2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { PageHeader, Badge, Btn, Spinner, BarList, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";

type Signal = { level: "critical" | "warning" | "good" | "info"; area: string; title: string; detail: string; href?: string };
const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const num = (n: number) => (n || 0).toLocaleString("en-IN");
const timeOf = (d?: string) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");

/* ───────── pieces ───────── */

const LEVEL = {
  critical: { Icon: AlertOctagon, text: "text-red-700", bg: "bg-red-50", ring: "ring-red-200", label: "Critical" },
  warning: { Icon: AlertTriangle, text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200", label: "Warning" },
  info: { Icon: Info, text: "text-sky-700", bg: "bg-sky-50", ring: "ring-sky-200", label: "Coming up" },
  good: { Icon: CheckCircle2, text: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200", label: "Going well" },
} as const;

function SignalRow({ s }: { s: Signal }) {
  const L = LEVEL[s.level];
  const body = (
    <div className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition ${s.href ? "hover:bg-ink-400/5" : ""}`}>
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${L.bg} ring-1 ${L.ring}`}>
        <L.Icon className={`h-4 w-4 ${L.text}`} aria-label={L.label} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-900">{s.title}</span>
        <span className="block text-[13px] leading-snug text-ink-500">
          <span className="font-medium text-ink-700">{s.area}</span> · {s.detail}
        </span>
      </span>
      {s.href && <ArrowRight className="mt-1.5 h-4 w-4 shrink-0 text-ink-400" />}
    </div>
  );
  return s.href ? <Link href={s.href}>{body}</Link> : body;
}

function HealthRing({ score, label }: { score: number; label: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const tone = score >= 85 ? "#059669" : score >= 70 ? "#0d9488" : score >= 50 ? "#d97706" : "#dc2626";
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={`Health score ${score} of 100 — ${label}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-ink-400/15" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-4xl font-extrabold leading-none text-ink-900">{score}</p>
          <p className="mt-1 text-xs font-semibold text-ink-500">of 100</p>
        </div>
      </div>
    </div>
  );
}

/** A KPI with its change vs the previous period. goodWhenUp decides the colour of the change (with an arrow + sign). */
function Kpi({ label, value, change, unit = "%", goodWhenUp = true, sub, href }: { label: string; value: string; change?: number | null; unit?: string; goodWhenUp?: boolean; sub?: React.ReactNode; href?: string }) {
  const flat = change == null || change === 0;
  const good = !flat && (change! > 0) === goodWhenUp;
  const Icon = flat ? Minus : change! > 0 ? TrendingUp : TrendingDown;
  const inner = (
    <div className="card h-full p-5 transition hover:shadow-md">
      <p className="text-[13px] font-semibold text-ink-500">{label}</p>
      <p className="mt-1.5 text-[28px] font-extrabold leading-tight text-ink-900">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        {change !== undefined && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${flat ? "bg-ink-400/10 text-ink-500" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            <Icon className="h-3.5 w-3.5" />
            {flat ? "no change" : `${change! > 0 ? "+" : ""}${change}${unit}`}
          </span>
        )}
        {sub && <span className="text-ink-500">{sub}</span>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

/** Leads per day: captured (light) with converted (dark) inside it — one axis, hover for the exact day. */
function Trend({ data }: { data: { d: string; n: number; won: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // > 92 days: weekly totals keep bars readable
  const rows = useMemo(() => {
    if (data.length <= 92) return data.map((x) => ({ ...x, label: new Date(x.d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) }));
    const out: { d: string; n: number; won: number; label: string }[] = [];
    for (let i = 0; i < data.length; i += 7) {
      const w = data.slice(i, i + 7);
      out.push({ d: w[0].d, n: w.reduce((a, x) => a + x.n, 0), won: w.reduce((a, x) => a + x.won, 0), label: `Week of ${new Date(w[0].d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` });
    }
    return out;
  }, [data]);
  const max = Math.max(4, ...rows.map((r) => r.n));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return <p className="py-16 text-center text-sm text-ink-400">No leads in this period</p>;
  const h = hover != null ? rows[hover] : null;
  return (
    <div>
      <div className="relative h-56">
        {/* recessive grid */}
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="absolute inset-x-0 border-t border-ink-400/10" style={{ bottom: `${(i / 4) * 100}%` }}>
            <span className="absolute -top-2.5 left-0 bg-white pr-1 text-[11px] text-ink-400">{step * i}</span>
          </div>
        ))}
        <div className="absolute inset-0 left-7 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {rows.map((r, i) => (
            <div key={r.d} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} aria-label={`${r.label}: ${r.n} captured, ${r.won} converted`}>
              <div className={`relative w-full overflow-hidden rounded-t-[4px] ${hover === i ? "bg-hive-400" : "bg-hive-200"}`} style={{ height: `${(r.n / top) * 100}%`, minHeight: r.n ? 2 : 0 }}>
                <div className="absolute inset-x-0 bottom-0 bg-hive-700" style={{ height: r.n ? `${(r.won / r.n) * 100}%` : 0 }} />
              </div>
            </div>
          ))}
        </div>
        {h && (
          <div className="pointer-events-none absolute -top-2 right-0 rounded-xl bg-ink-900 px-3 py-2 text-xs text-white shadow-lg">
            <p className="font-semibold">{h.label}</p>
            <p>
              {h.n} captured · {h.won} converted{h.n ? ` (${Math.round((h.won / h.n) * 100)}%)` : ""}
            </p>
          </div>
        )}
      </div>
      <div className="ml-7 mt-2 flex justify-between text-[11px] text-ink-400">
        <span>{rows[0]?.label}</span>
        <span>{rows[rows.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function Section({ title, right, children, className = "" }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-bold text-ink-900">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Mini({ label, value, tone = "ink" }: { label: string; value: React.ReactNode; tone?: "ink" | "red" | "amber" | "green" }) {
  const c = { ink: "text-ink-900", red: "text-red-700", amber: "text-amber-700", green: "text-emerald-700" }[tone];
  return (
    <div className="rounded-xl bg-ink-400/5 px-3 py-2.5">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`text-lg font-bold ${c}`}>{value}</p>
    </div>
  );
}

/* ───────── page ───────── */

export default function CompanyDashboard() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const toast = useToast();
  const perm = usePerm("wa_webhooks:webhooks");
  const req = useRef(0);

  const load = useCallback(
    async (force = false) => {
      const id = ++req.current;
      setBusy(true);
      try {
        const o = await api<any>(`/co/dashboard/overview?days=${days}`);
        if (id !== req.current) return;
        setD(o);
        setBusy(false);
        // recommendations on every refresh — regenerated when the numbers changed (unchanged data reuses the last answer)
        setRecBusy(true);
        const r = await api<any>("/co/dashboard/insights", { body: { days, force } }).catch((e) => ({ error: e.message }));
        if (id === req.current) setRec(r);
      } catch (e: any) {
        toast("err", e.message);
      } finally {
        if (id === req.current) {
          setBusy(false);
          setRecBusy(false);
        }
      }
    },
    [days] // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    setD(null);
    setRec(null);
    load();
  }, [load]);

  const sig: Signal[] = d?.signals || [];
  const alerts = sig.filter((s) => s.level === "critical");
  const upcoming = sig.filter((s) => s.level === "info");
  const notWell = sig.filter((s) => s.level === "warning");
  const well = sig.filter((s) => s.level === "good");

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={d ? `Your organisation at a glance · live data, refreshed ${timeOf(d.generatedAt)}` : "Your organisation at a glance"}
        actions={
          <div className="flex flex-wrap gap-2">
            <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last 12 months</option>
            </select>
            <Btn variant="secondary" onClick={() => load()} disabled={busy}>
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
            </Btn>
            {perm.read && (
              <Btn
                variant="secondary"
                loading={sharing}
                title="Send this snapshot and the recommendations through your “AI insights” WhatsApp webhook"
                onClick={async () => {
                  setSharing(true);
                  try {
                    const r = await api<any>("/co/dashboard/share", { body: { days } });
                    toast("ok", `Shared on WhatsApp (${r.sent} message${r.sent === 1 ? "" : "s"})`);
                  } catch (e: any) {
                    toast("err", e.message);
                  } finally {
                    setSharing(false);
                  }
                }}
              >
                <MessageCircle className="h-4 w-4" /> Share on WhatsApp
              </Btn>
            )}
          </div>
        }
      />
      {!d ? (
        <div className="flex justify-center py-24 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1 · health + alerts */}
          <div className="grid gap-6 xl:grid-cols-12">
            <section className="card flex flex-col gap-5 p-6 sm:flex-row sm:items-center xl:col-span-5">
              <HealthRing score={d.health.score} label={d.health.label} />
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-wide text-ink-400">Organisation health</p>
                <p className="mt-1 text-2xl font-extrabold text-ink-900">{d.health.label}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-red-700 ring-1 ring-red-200">
                    <AlertOctagon className="h-3.5 w-3.5" /> {d.health.critical} critical
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 ring-1 ring-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5" /> {d.health.warning} not going well
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {d.health.good} going well
                  </span>
                </div>
                {rec?.summary && <p className="mt-3 text-sm leading-relaxed text-ink-700">{rec.summary}</p>}
              </div>
            </section>
            <Section title={<span className="flex items-center gap-2">Check now {alerts.length > 0 && <Badge color="red">{alerts.length}</Badge>}</span>} className="xl:col-span-7">
              {alerts.length || upcoming.length ? (
                <div className="-mx-3 space-y-0.5">
                  {[...alerts, ...upcoming].slice(0, 6).map((s, i) => (
                    <SignalRow key={i} s={s} />
                  ))}
                </div>
              ) : (
                <p className="flex items-center gap-2 py-6 text-sm text-ink-500">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Nothing alarming right now.
                </p>
              )}
            </Section>
          </div>

          {/* 2 · the numbers that matter */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Leads captured" value={num(d.leads.total)} change={d.leads.totalPrev || d.leads.total ? d.leads.change : null} sub={`${d.leads.today} today`} href="/app/leads" />
            <Kpi label="Conversion rate" value={`${d.leads.conv}%`} change={d.leads.totalPrev ? d.leads.convDelta : null} unit=" pts" sub={`${num(d.leads.won)} converted`} />
            <Kpi label="Open pipeline" value={num(d.pipeline.open)} sub={d.speed.uncontacted24h ? <span className="font-semibold text-amber-700">{d.speed.uncontacted24h} waiting 24 h+</span> : "all contacted in time"} href="/app/leads" />
            <Kpi label="Follow-ups overdue" value={num(d.followups.overdue)} sub={`${d.followups.dueToday} due today`} href="/app/leads?sort=updated" />
            <Kpi label="Collected" value={inr(d.money.collected)} change={d.money.collectedPrev || d.money.collected ? d.money.collectedChange : null} sub="client payments" href="/app/clients?tab=subscription" />
            <Kpi label="Over due payments" value={inr(d.money.overdue)} sub={d.money.overdueCount ? <span className="font-semibold text-red-700">{d.money.overdueCount} payment(s)</span> : "none — great"} href="/app/clients?tab=subscription" />
            <Kpi label="Clients" value={num(d.clients.total)} change={d.clients.newPrev || d.clients.new ? d.clients.new - d.clients.newPrev : null} unit="" sub={`${d.clients.new} new this period`} href="/app/clients" />
            <Kpi label="Open support tickets" value={num(d.support.open)} sub={d.support.grievances ? <span className="font-semibold text-red-700">{d.support.grievances} grievance(s)</span> : d.support.stale48h ? `${d.support.stale48h} older than 48 h` : "all fresh"} href="/app/clients?tab=support" />
          </div>

          {/* 3 · AI recommendations + going well / not going well */}
          <div className="grid gap-6 xl:grid-cols-12">
            <Section
              className="xl:col-span-7"
              title={
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-hive-600" /> {rec?.source === "ai" ? "AI recommendations" : "Recommendations"}
                </span>
              }
              right={
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  {recBusy ? (
                    <span className="flex items-center gap-1.5">
                      <Spinner className="h-3.5 w-3.5" /> analysing live data…
                    </span>
                  ) : rec?.at ? (
                    <span>
                      {rec.source === "ai" ? `${rec.model} · ` : ""}
                      {timeOf(rec.at)}
                    </span>
                  ) : null}
                  <button className="btn-ghost px-2 py-1" title="Regenerate now" onClick={() => load(true)} disabled={recBusy}>
                    <Wand2 className="h-4 w-4" />
                  </button>
                </div>
              }
            >
              {!rec ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-ink-400/10" />
                  ))}
                </div>
              ) : rec.error ? (
                <p className="text-sm text-red-700">{rec.error}</p>
              ) : (
                <>
                  <ol className="space-y-3">
                    {rec.recommendations.map((r: any, i: number) => (
                      <li key={i} className="flex gap-3 rounded-xl border border-ink-400/10 p-3.5">
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${r.priority === "high" ? "bg-red-50 text-red-700" : r.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-ink-400/10 text-ink-700"}`}>{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink-900">
                            {r.title} <span className="ml-1 text-xs font-medium text-ink-400">{r.area} · {r.priority} priority</span>
                          </p>
                          <p className="mt-0.5 text-sm text-ink-700">→ {r.action}</p>
                          {r.why && <p className="mt-0.5 text-xs text-ink-500">Why: {r.why}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {rec.note && <p className="mt-3 text-xs text-ink-400">{rec.note}</p>}
                </>
              )}
            </Section>
            <div className="grid gap-6 xl:col-span-5">
              <Section title={<span className="flex items-center gap-2 text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Going well</span>}>
                {well.length ? <div className="-mx-3">{well.slice(0, 4).map((s, i) => <SignalRow key={i} s={s} />)}</div> : <p className="text-sm text-ink-400">Nothing stands out yet — more data will show trends.</p>}
              </Section>
              <Section title={<span className="flex items-center gap-2 text-amber-800"><AlertTriangle className="h-4 w-4" /> Not going well</span>}>
                {notWell.length ? <div className="-mx-3">{notWell.slice(0, 4).map((s, i) => <SignalRow key={i} s={s} />)}</div> : <p className="text-sm text-ink-400">No warning signs in this period.</p>}
              </Section>
            </div>
          </div>

          {/* 4 · trend + follow-ups */}
          <div className="grid gap-6 xl:grid-cols-12">
            <Section
              className="xl:col-span-8"
              title={d.trend.length > 92 ? "Leads per week" : "Leads per day"}
              right={
                <div className="flex gap-4 text-xs text-ink-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-hive-200" /> captured
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-hive-700" /> converted
                  </span>
                </div>
              }
            >
              <Trend data={d.trend} />
            </Section>
            <Section className="xl:col-span-4" title="Follow-ups due" right={<Link href="/app/leads?sort=updated" className="text-sm font-semibold text-hive-700">Open →</Link>}>
              {d.followups.list.length ? (
                <ul className="divide-y divide-ink-400/10">
                  {d.followups.list.map((l: any) => {
                    const late = l.nextFollowUpAt && new Date(l.nextFollowUpAt) < new Date(new Date().toDateString());
                    return (
                      <li key={l._id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink-900">{l.name || l.whatsapp || l.phone || "—"}</span>
                          <span className="block text-xs text-ink-500">{l.status} · {l.source}</span>
                        </span>
                        <span className={`shrink-0 text-xs font-semibold ${late ? "text-red-700" : "text-ink-500"}`}>{l.nextFollowUpAt ? (late ? `overdue · ${fmtDate(l.nextFollowUpAt)}` : fmtDate(l.nextFollowUpAt)) : "needs follow-up"}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="py-8 text-center text-sm text-ink-400">Nothing due. Nice.</p>
              )}
            </Section>
          </div>

          {/* 5 · breakdowns */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Section title="Open pipeline by stage">
              <BarList rows={d.pipeline.byStatus.map((x: any) => ({ label: x.status, value: x.n }))} empty="No open leads" />
            </Section>
            <Section title="Sources">
              <BarList rows={d.sources.slice(0, 8).map((x: any) => ({ label: x.source, value: x.n, sub: `${x.conv}% conv.` }))} color="bg-hive-400" empty="No leads in this period" />
            </Section>
            <Section title="Lost reasons">
              <BarList rows={d.lostReasons.slice(0, 6).map((x: any) => ({ label: x.reason, value: x.n }))} color="bg-ink-400" empty="No lost leads in this period" />
            </Section>
          </div>

          {/* 6 · area health */}
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <Section title="Clients & money">
              <div className="grid grid-cols-2 gap-2">
                <Mini label="Collected" value={inr(d.money.collected)} tone="green" />
                <Mini label="Over due" value={inr(d.money.overdue)} tone={d.money.overdueCount ? "red" : "ink"} />
                <Mini label="Due in 7 days" value={inr(d.money.upcoming)} tone={d.money.upcomingCount ? "amber" : "ink"} />
                <Mini label="New clients" value={num(d.clients.new)} />
              </div>
            </Section>
            <Section title="Support">
              <div className="grid grid-cols-2 gap-2">
                <Mini label="Open" value={num(d.support.open)} />
                <Mini label="Grievances" value={num(d.support.grievances)} tone={d.support.grievances ? "red" : "ink"} />
                <Mini label="Older than 48 h" value={num(d.support.stale48h)} tone={d.support.stale48h ? "amber" : "ink"} />
                <Mini label="Avg. resolution" value={d.support.avgResolutionHours != null ? `${d.support.avgResolutionHours} h` : "—"} />
              </div>
            </Section>
            <Section title="WhatsApp delivery">
              <div className="grid grid-cols-2 gap-2">
                <Mini label="Sent" value={num(d.whatsapp.sent)} />
                <Mini label="Delivered" value={d.whatsapp.successRate != null ? `${d.whatsapp.successRate}%` : "—"} tone={d.whatsapp.successRate != null && d.whatsapp.successRate < 90 ? "red" : "green"} />
                <Mini label="Retrying" value={num(d.whatsapp.retrying)} tone={d.whatsapp.retrying ? "amber" : "ink"} />
                <Mini label="Undelivered" value={num(d.whatsapp.dead)} tone={d.whatsapp.dead ? "red" : "ink"} />
              </div>
            </Section>
            <Section title="AI & integrations">
              <div className="grid grid-cols-2 gap-2">
                {d.ai.length ? (
                  d.ai.slice(0, 2).map((a: any) => <Mini key={a.model} label={`${a.model} credits`} value={`${a.remaining.toFixed(0)} / ${a.credits}`} tone={a.credits && a.remaining / a.credits < 0.1 ? "red" : "ink"} />)
                ) : (
                  <Mini label="AI credits" value="—" />
                )}
                <Mini label="Active integrations" value={num(d.integrations.active)} />
                <Mini label="Failed imports" value={num(d.integrations.deadEvents)} tone={d.integrations.deadEvents ? "amber" : "ink"} />
              </div>
            </Section>
          </div>
        </div>
      )}
    </>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import { Coins, Wallet, Gauge, MessagesSquare, Cpu, IndianRupee, CalendarClock } from "lucide-react";
import { api } from "@/lib/api";
import { Modal, Spinner, Pager } from "./ui";

const inr = (n: number, d = 2) => `₹${(n || 0).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const num = (n: number, d = 0) => (n || 0).toLocaleString("en-IN", { maximumFractionDigits: d });
const PURPOSE: Record<string, string> = { chat: "Agent chat", assistant: "Floating assistant", report: "Agentic report" };

/** A typical reply ≈ 1,500 input + 400 output tokens — used only to give a feel for the price. */
export function estimateReply(m: any) {
  const weighted = 1500 * (m.tokenWeights?.input ?? 1) + 400 * (m.tokenWeights?.output ?? 3);
  return { credits: weighted / 1000, rupees: (weighted / 1000) * (m.companyRate || 0) };
}

/** Charges for the model picked in the Create / Edit AI agent pop-up. */
export function ModelCharges({ model }: { model: any }) {
  if (!model) return null;
  const est = estimateReply(model);
  const pct = model.credits ? Math.max(0, Math.min(100, (model.remaining / model.credits) * 100)) : 0;
  return (
    <div className="mt-2.5 overflow-hidden rounded-2xl border border-hive-200 bg-gradient-to-br from-hive-50 to-white">
      <div className="flex items-center justify-between gap-3 border-b border-hive-100 px-4 py-2.5">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink-900">
          <Cpu className="h-4 w-4 shrink-0 text-hive-700" />
          <span className="truncate">{model.providerName}</span>
          <span className="mono truncate text-xs font-normal text-ink-500">{model.llmVersion}</span>
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-hive-100 text-sm sm:grid-cols-4">
        <div className="bg-white px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Rate</dt>
          <dd className="mt-0.5 font-bold text-ink-900">{inr(model.companyRate)}</dd>
          <dd className="text-[11px] text-ink-500">per credit</dd>
        </div>
        <div className="bg-white px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Token weights</dt>
          <dd className="mt-0.5 font-bold text-ink-900">
            ×{model.tokenWeights.input} / ×{model.tokenWeights.output}
          </dd>
          <dd className="text-[11px] text-ink-500">input / output</dd>
        </div>
        <div className="bg-white px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Typical reply</dt>
          <dd className="mt-0.5 font-bold text-ink-900">≈ {inr(est.rupees)}</dd>
          <dd className="text-[11px] text-ink-500">{num(est.credits, 1)} credits</dd>
        </div>
        <div className="bg-white px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Credits left</dt>
          <dd className={`mt-0.5 font-bold ${pct > 10 ? "text-hive-800" : "text-red-600"}`}>
            {num(model.remaining, 1)} <span className="text-xs font-normal text-ink-400">/ {num(model.credits)}</span>
          </dd>
          <dd className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-400/15">
            <span className={`block h-full rounded-full ${pct > 10 ? "bg-hive-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
          </dd>
        </div>
      </dl>
      <p className="px-4 py-2 text-[11px] text-ink-500">1 credit = 1,000 weighted tokens (input × {model.tokenWeights.input} + output × {model.tokenWeights.output}). Credits are shared by all agents on this model.</p>
    </div>
  );
}

/** Usage history pop-up for one AI agent: credits left, cost incurred, 30-day trend, breakdown and every call. */
export function UsageModal({ agent, onClose }: { agent: any | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!agent) return;
    setErr("");
    api(`/co/ai-agents/${agent._id}/usage?page=${page}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [agent, page]);
  useEffect(() => {
    if (!agent) {
      setData(null);
      setPage(1);
    }
  }, [agent]);

  const days = useMemo(() => {
    const out: { day: string; billed: number; calls: number; credits: number }[] = [];
    const map = new Map((data?.daily || []).map((d: any) => [d.day, d]));
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const v: any = map.get(key);
      out.push({ day: key, billed: v?.billed || 0, calls: v?.calls || 0, credits: v?.credits || 0 });
    }
    return out;
  }, [data]);
  const peak = Math.max(...days.map((d) => d.credits), 0.0001);
  const w = data?.wallet;
  const pct = w?.credits ? Math.max(0, Math.min(100, (w.remaining / w.credits) * 100)) : 0;

  return (
    <Modal open={!!agent} onClose={onClose} size="xl" title={<span className="flex items-center gap-2">Usage · {agent?.name}</span>}>
      {err && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
      {!data && !err && (
        <div className="flex justify-center py-20 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      )}
      {data && (
        <div className="space-y-6">
          {/* hero: wallet */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-hive-800 via-hive-900 to-hive-950 p-5 text-white sm:p-6">
            <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5" />
            <div aria-hidden className="absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-honey-300/10" />
            <div className="relative flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
                  <Wallet className="h-3.5 w-3.5" /> Credits left on {data.model?.name || "model"}
                </p>
                <p className="mt-1.5 text-4xl font-extrabold tracking-tight">
                  {w ? num(w.remaining, 1) : "—"}
                  {w && <span className="ml-2 text-base font-medium text-white/55">of {num(w.credits)}</span>}
                </p>
                {data.model && (
                  <p className="mt-1 text-xs text-white/60">
                    <span className="mono">{data.model.llmVersion}</span> · {inr(data.model.companyRate)} per credit
                  </p>
                )}
              </div>
              <div className="w-full max-w-xs">
                <div className="flex justify-between text-[11px] text-white/60">
                  <span>{num(w?.used || 0, 1)} used</span>
                  <span>{Math.round(pct)}% left</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/15">
                  <span className={`block h-full rounded-full ${pct > 10 ? "bg-gradient-to-r from-honey-300 to-honey-500" : "bg-red-400"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { icon: IndianRupee, label: "Cost incurred", value: inr(data.totals.billed), hint: "by this agent" },
              { icon: Coins, label: "Credits used", value: num(data.totals.credits, 2), hint: "by this agent" },
              { icon: MessagesSquare, label: "AI calls", value: num(data.totals.calls), hint: data.totals.last ? `last ${new Date(data.totals.last).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "none yet" },
              { icon: Gauge, label: "Tokens", value: num(data.totals.inputTokens + data.totals.outputTokens), hint: `${num(data.totals.inputTokens)} in · ${num(data.totals.outputTokens)} out` },
            ].map((k) => (
              <div key={k.label} className="rounded-2xl border border-ink-400/12 bg-white p-4 shadow-card">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  <k.icon className="h-3.5 w-3.5 text-hive-600" /> {k.label}
                </p>
                <p className="mt-1.5 text-xl font-extrabold text-ink-900">{k.value}</p>
                <p className="text-[11.5px] text-ink-500">{k.hint}</p>
              </div>
            ))}
          </div>

          {/* 30-day trend + breakdown */}
          <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
            <div className="rounded-2xl border border-ink-400/12 bg-white p-4 shadow-card">
              <p className="mb-3 text-sm font-bold text-ink-900">Credits per day · last 30 days</p>
              <div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Daily credit usage for the last 30 days">
                {days.map((d) => (
                  <div key={d.day} className="group relative flex h-full flex-1 items-end">
                    <div className={`w-full rounded-t ${d.credits ? "bg-hive-500 group-hover:bg-hive-700" : "bg-ink-400/10"}`} style={{ height: d.credits ? `${Math.max(6, (d.credits / peak) * 100)}%` : "4%" }} />
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[11px] text-white group-hover:block">
                      {new Date(d.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {num(d.credits, 2)} cr · {inr(d.billed)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[10.5px] text-ink-400">
                <span>{new Date(days[0].day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                <span>Today</span>
              </div>
            </div>
            <div className="rounded-2xl border border-ink-400/12 bg-white p-4 shadow-card">
              <p className="mb-3 text-sm font-bold text-ink-900">Where it was used</p>
              {data.byPurpose.length ? (
                <ul className="space-y-2.5">
                  {data.byPurpose.map((p: any) => (
                    <li key={p.purpose}>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-ink-700">{PURPOSE[p.purpose] || p.purpose}</span>
                        <span className="font-semibold text-ink-900">{inr(p.billed)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-400/10">
                        <span className="block h-full rounded-full bg-honey-500" style={{ width: `${data.totals.credits ? (p.credits / data.totals.credits) * 100 : 0}%` }} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        {num(p.calls)} calls · {num(p.credits, 2)} credits
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-400">No usage yet.</p>
              )}
            </div>
          </div>

          {/* history */}
          <div className="overflow-hidden rounded-2xl border border-ink-400/12 bg-white shadow-card">
            <p className="flex items-center gap-2 border-b border-ink-400/10 px-4 py-3 text-sm font-bold text-ink-900">
              <CalendarClock className="h-4 w-4 text-hive-700" /> Usage history
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead>
                  <tr>
                    {["Time", "User", "Used for", "Tokens in / out", "Credits", "Cost"].map((h) => (
                      <th key={h} className={`th ${["Credits", "Cost"].includes(h) ? "text-right" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: any) => (
                    <tr key={r._id} className="hover:bg-hive-50/40">
                      <td className="td whitespace-nowrap">{new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="td">{r.user}</td>
                      <td className="td">{PURPOSE[r.purpose] || r.purpose}</td>
                      <td className="td mono text-xs">
                        {num(r.inputTokens)} / {num(r.outputTokens)}
                      </td>
                      <td className="td text-right font-medium">{num(r.credits, 3)}</td>
                      <td className="td text-right font-semibold">{inr(r.billed)}</td>
                    </tr>
                  ))}
                  {!data.rows.length && (
                    <tr>
                      <td colSpan={6} className="td py-10 text-center text-ink-400">
                        No calls yet — use “Test”, the floating assistant or an Agentic Report and they’ll show here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {data.total > data.limit && (
              <div className="border-t border-ink-400/10 px-4 py-2">
                <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCcw, Gauge, Layers, PlugZap, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader, Badge, Btn, Spinner, Empty, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
const ago = (d?: string) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const JOB_LABEL: Record<string, string> = { "leads.import": "Lead import", "leads.export": "Lead export", "wa.redeliver": "WhatsApp redelivery", "ai.insights": "AI insights digest" };

function Budget({ title, x }: { title: string; x: any }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-500">{title}</p>
        {x.count ? x.ok ? <Badge color="green">Within budget</Badge> : <Badge color="red">Over budget</Badge> : <Badge color="gray">No traffic yet</Badge>}
      </div>
      <p className="mt-2 text-3xl font-extrabold text-ink-900">
        {x.count ? ms(x.p95) : "—"} <span className="text-base font-semibold text-ink-400">p95 · budget {ms(x.budget)}</span>
      </p>
      <p className="mt-1 text-sm text-ink-500">
        p50 {x.count ? ms(x.p50) : "—"} · {x.count.toLocaleString("en-IN")} requests
      </p>
    </div>
  );
}

export default function SystemHealth() {
  const [d, setD] = useState<any>(null);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState("");
  const perm = usePerm("system");
  const toast = useToast();
  const load = useCallback(() => api(`/sa/system/health?hours=${hours}`).then(setD).catch((e) => toast("err", e.message)), [hours]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const js = d?.jobs?.byStatus || {};
  return (
    <>
      <PageHeader
        title="System Health"
        subtitle="API speed against the 300 ms read / 500 ms write budgets, background jobs and external providers."
        actions={
          <div className="flex gap-2">
            <select className="input w-auto" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Period">
              <option value={1}>Last hour</option>
              <option value={24}>Last 24 hours</option>
              <option value={168}>Last 7 days</option>
            </select>
            <Btn variant="secondary" onClick={() => load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Btn>
          </div>
        }
      />
      {!d ? (
        <div className="flex justify-center py-20 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Budget title="Read APIs (GET)" x={d.overall.read} />
            <Budget title="Write APIs" x={d.overall.write} />
            <div className="card p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-500">
                <Layers className="h-4 w-4" /> Background jobs
              </p>
              <p className="mt-2 text-3xl font-extrabold text-ink-900">{(js.queued || 0) + (js.running || 0)} <span className="text-base font-semibold text-ink-400">in queue</span></p>
              <p className="mt-1 text-sm text-ink-500">
                {js.failed || 0} retrying · <span className={js.dead ? "font-semibold text-red-600" : ""}>{js.dead || 0} dead-lettered</span> · {js.done || 0} done (14 d)
              </p>
            </div>
            <div className="card p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-500">
                <PlugZap className="h-4 w-4" /> External providers
              </p>
              <p className="mt-2 text-3xl font-extrabold text-ink-900">
                {d.providers.filter((p: any) => p.open).length} <span className="text-base font-semibold text-ink-400">paused (circuit open)</span>
              </p>
              <p className="mt-1 text-sm text-ink-500">{d.providers.length} tracked · calls resume automatically</p>
            </div>
          </div>

          <section className="card overflow-x-auto">
            <div className="flex items-center gap-2 border-b border-ink-400/15 px-5 py-4">
              <Gauge className="h-4 w-4 text-hive-700" />
              <h2 className="font-bold">API latency by route</h2>
              <span className="text-sm text-ink-500">· AI, provider and file routes are shown without a budget (they wait on external services)</span>
            </div>
            {d.routes.length ? (
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr>
                    {["Route", "Requests", "Errors", "p50", "p95", "Max", "Budget", "Status"].map((h) => (
                      <th key={h} className="th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.routes.slice(0, 80).map((r: any) => (
                    <tr key={r.method + r.route} className="hover:bg-hive-50/40">
                      <td className="td font-mono text-[12.5px]">
                        <span className="mr-2 inline-block w-12 font-semibold text-ink-500">{r.method}</span>
                        {r.route}
                      </td>
                      <td className="td">{r.count.toLocaleString("en-IN")}</td>
                      <td className={`td ${r.errors ? "font-semibold text-red-600" : "text-ink-400"}`}>{r.errors}</td>
                      <td className="td">{ms(r.p50)}</td>
                      <td className="td font-semibold">{ms(r.p95)}</td>
                      <td className="td text-ink-500">{ms(r.max)}</td>
                      <td className="td text-ink-500">{r.budget ? ms(r.budget) : "external"}</td>
                      <td className="td">{r.ok == null ? <Badge color="gray">n/a</Badge> : r.ok ? <Badge color="green">OK</Badge> : <Badge color="red">Slow</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No requests recorded yet" hint="Latency is collected as people use the app." />
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="card">
              <div className="border-b border-ink-400/15 px-5 py-4">
                <h2 className="font-bold">Jobs needing attention</h2>
                <p className="text-sm text-ink-500">Retrying jobs back off automatically (30 s → 6 h). Dead-lettered jobs stop until replayed.</p>
              </div>
              {d.jobs.problems.length ? (
                <ul className="divide-y divide-ink-400/10">
                  {d.jobs.problems.map((j: any) => (
                    <li key={j._id} className="flex items-start gap-3 px-5 py-3">
                      {j.status === "dead" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-semibold">
                          {JOB_LABEL[j.type] || j.type} · {j.company} {j.status === "dead" ? <Badge color="red">dead-lettered</Badge> : <Badge color="honey">retrying</Badge>}
                        </p>
                        <p className="truncate text-ink-500" title={j.error}>
                          {j.attempts} attempt(s) · {j.error || "—"}
                        </p>
                        <p className="text-xs text-ink-400">{j.status === "dead" ? `stopped ${ago(j.finishedAt)}` : `next try ${ago(j.nextAttemptAt)}`}</p>
                      </div>
                      {perm.update && (
                        <Btn
                          variant="secondary"
                          loading={busy === j._id}
                          onClick={async () => {
                            setBusy(j._id);
                            try {
                              const r = await api<any>(`/sa/system/jobs/${j._id}/retry`, { method: "POST" });
                              toast(r.status === "done" ? "ok" : "err", r.status === "done" ? "Replayed — done" : `Replayed — ${r.status}${r.error ? `: ${r.error}` : ""}`);
                              load();
                            } catch (e: any) {
                              toast("err", e.message);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          <RotateCcw className="h-4 w-4" /> Replay
                        </Btn>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-2 px-5 py-8 text-sm text-ink-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> No failed or dead-lettered jobs.
                </div>
              )}
            </section>

            <section className="card">
              <div className="border-b border-ink-400/15 px-5 py-4">
                <h2 className="font-bold">Provider circuit breakers</h2>
                <p className="text-sm text-ink-500">After 5 failures in a row a provider is paused (1 → 30 min); messages queue and are redelivered when it recovers.</p>
              </div>
              {d.providers.length ? (
                <ul className="divide-y divide-ink-400/10">
                  {d.providers.map((p: any) => (
                    <li key={p.host} className="flex items-start gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono font-semibold">{p.host}</p>
                        <p className="truncate text-ink-500" title={p.lastError}>
                          {p.open ? <Badge color="red">paused until {ago(p.openUntil)}</Badge> : p.failures ? <Badge color="honey">{p.failures} recent failure(s)</Badge> : <Badge color="green">healthy</Badge>} {p.lastError ? `· ${p.lastError}` : ""}
                        </p>
                        <p className="text-xs text-ink-400">
                          last failure {ago(p.lastFailureAt)} · last success {ago(p.lastSuccessAt)}
                        </p>
                      </div>
                      {perm.update && (p.open || p.failures > 0) && (
                        <Btn
                          variant="secondary"
                          onClick={async () => {
                            await api(`/sa/system/providers/${encodeURIComponent(p.host)}/reset`, { method: "POST" });
                            load();
                          }}
                        >
                          Reset
                        </Btn>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-2 px-5 py-8 text-sm text-ink-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> No provider failures recorded.
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}

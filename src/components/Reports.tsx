"use client";
import { useEffect, useMemo, useState } from "react";
import { Play, FileSpreadsheet, FileText, Plus, X, Sparkles, Wand2, Table2, BarChart3 } from "lucide-react";
import { api, download, fmtDate } from "@/lib/api";
import { Btn, Field, Spinner, Empty, Badge, useToast, BarList, Columns } from "./ui";

interface FieldDef {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "enum";
  options?: string[];
}
interface DatasetDef {
  key: string;
  label: string;
  dateField: string;
  fields: FieldDef[];
}
export interface Report {
  title: string;
  columns: { key: string; label: string; type: string }[];
  rows: any[];
  truncated?: boolean;
  spec: any;
  chart?: string;
  explanation?: string;
  insights?: string;
}

const OPS: Record<string, { v: string; l: string }[]> = {
  string: [
    { v: "contains", l: "contains" },
    { v: "eq", l: "is" },
    { v: "ne", l: "is not" },
    { v: "exists", l: "is filled" },
  ],
  enum: [
    { v: "eq", l: "is" },
    { v: "ne", l: "is not" },
    { v: "in", l: "is any of" },
  ],
  number: [
    { v: "gte", l: "≥" },
    { v: "lte", l: "≤" },
    { v: "eq", l: "=" },
  ],
  date: [
    { v: "gte", l: "on/after" },
    { v: "lte", l: "on/before" },
  ],
};

const fmtCell = (v: any, type: string) => (v == null || v === "" ? "—" : type === "date" ? fmtDate(v, true) : type === "number" ? Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : Array.isArray(v) ? v.join(", ") : String(v));

/** Result view shared by DIY and Agentic: chart (when grouped) + table + export. */
export function ReportResult({ base, report }: { base: "/sa" | "/co"; report: Report }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const grouped = report.columns.some((c) => c.key === "count" || /^(sum|avg|min|max)_/.test(c.key));
  const metric = report.columns.find((c) => c.key === "count" || /^(sum|avg|min|max)_/.test(c.key));
  const dim = report.columns.find((c) => c !== metric && !/^(count|sum_|avg_|min_|max_)/.test(c.key));
  const isTime = dim?.type === "date";
  const exp = async (format: "xlsx" | "csv") => {
    setBusy(format);
    try {
      await download(`${base}/reports/export?format=${format}`, report.spec, `report.${format}`);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-400/15 px-5 py-4">
        <div>
          <h3 className="font-bold">{report.title}</h3>
          <p className="text-xs text-ink-500">
            {report.rows.length.toLocaleString("en-IN")} row{report.rows.length === 1 ? "" : "s"}
            {report.truncated ? " · preview — export for all rows" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Btn variant="secondary" loading={busy === "xlsx"} onClick={() => exp("xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Btn>
          <Btn variant="secondary" loading={busy === "csv"} onClick={() => exp("csv")}>
            <FileText className="h-4 w-4" /> CSV
          </Btn>
        </div>
      </div>
      {report.explanation && <p className="border-b border-ink-400/10 bg-hive-50/50 px-5 py-3 text-sm text-ink-700">{report.explanation}</p>}
      {report.insights && <div className="whitespace-pre-line border-b border-ink-400/10 px-5 py-4 text-sm leading-relaxed text-ink-900">{report.insights}</div>}
      {grouped && dim && metric && report.rows.length > 0 && report.chart !== "table" && (
        <div className="border-b border-ink-400/10 px-5 py-5">
          {report.chart === "kpi" && report.rows.length === 1 ? (
            <p className="text-4xl font-extrabold tabular-nums">{fmtCell(report.rows[0][metric.key], "number")}</p>
          ) : isTime ? (
            <Columns data={report.rows.map((r) => ({ _id: fmtDate(r[dim.key], false), n: Number(r[metric.key]) || 0 }))} />
          ) : (
            <BarList rows={report.rows.slice(0, 15).map((r) => ({ label: fmtCell(r[dim.key], dim.type), value: Number(r[metric.key]) || 0 }))} />
          )}
        </div>
      )}
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[640px]">
          <thead className="sticky top-0 z-[1]">
            <tr>
              {report.columns.map((c) => (
                <th key={c.key} className={`th ${c.type === "number" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.slice(0, 500).map((r, i) => (
              <tr key={i} className="hover:bg-hive-50/40">
                {report.columns.map((c) => (
                  <td key={c.key} className={`td max-w-[320px] truncate ${c.type === "number" ? "text-right tabular-nums" : ""}`} title={typeof r[c.key] === "string" ? r[c.key] : undefined}>
                    {fmtCell(r[c.key], c.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!report.rows.length && <Empty title="No data for these filters" />}
      </div>
    </div>
  );
}

/** DIY report builder. */
export function ReportBuilder({ base }: { base: "/sa" | "/co" }) {
  const [sets, setSets] = useState<DatasetDef[] | null>(null);
  const [companies, setCompanies] = useState<{ _id: string; name: string }[]>([]);
  const [ds, setDs] = useState("");
  const [mode, setMode] = useState<"list" | "group">("group");
  const [cols, setCols] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState("");
  const [bucket, setBucket] = useState("month");
  const [metric, setMetric] = useState("count");
  const [filters, setFilters] = useState<{ field: string; op: string; value: string }[]>([]);
  const [range, setRange] = useState({ from: "", to: "", companyId: "" });
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api<DatasetDef[]>(`${base}/reports/datasets`).then((d) => {
      setSets(d);
      if (d[0]) pick(d[0]);
    });
    if (base === "/sa") api("/sa/companies-lite").then(setCompanies).catch(() => {});
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = useMemo(() => sets?.find((s) => s.key === ds), [sets, ds]);
  function pick(d: DatasetDef) {
    setDs(d.key);
    setCols(d.fields.slice(0, 6).map((f) => f.key));
    setGroupBy(d.fields.find((f) => f.type === "enum")?.key || d.fields.find((f) => f.key === "source")?.key || d.dateField);
    setFilters([]);
    setMetric("count");
    setReport(null);
  }

  const spec = () => {
    const f = def?.fields.find((x) => x.key === groupBy);
    const s: any = {
      dataset: ds,
      title: `${def?.label}${mode === "group" ? ` by ${f?.label || groupBy}${f?.type === "date" ? ` (${bucket})` : ""}` : ""}`,
      from: range.from || undefined,
      to: range.to || undefined,
      companyId: range.companyId || undefined,
      filters: filters.filter((x) => x.field && (x.op === "exists" || x.value !== "")).map((x) => ({ field: x.field, op: x.op, value: x.op === "in" ? x.value.split(",").map((v) => v.trim()) : x.value })),
    };
    if (mode === "list") Object.assign(s, { columns: cols, limit: 2000 });
    else Object.assign(s, { groupBy: [f?.type === "date" ? `${groupBy}:${bucket}` : groupBy], metrics: [metric === "count" ? { op: "count" } : { op: metric.split(":")[0], field: metric.split(":")[1] }], limit: 500 });
    return s;
  };

  async function run() {
    setBusy(true);
    try {
      setReport(await api(`${base}/reports/run`, { body: spec() }));
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!sets)
    return (
      <div className="flex justify-center py-20 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  if (!sets.length) return <div className="card"><Empty title="No data sources available" hint="Your role doesn’t include any module that can be reported on." /></div>;
  const numFields = def?.fields.filter((f) => f.type === "number") || [];

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <div className="card h-fit space-y-5 p-5">
        <Field label="Data">
          <select className="input" value={ds} onChange={(e) => pick(sets.find((s) => s.key === e.target.value)!)}>
            {sets.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="inline-flex w-full rounded-xl border border-ink-400/20 p-1" role="tablist">
          {(
            [
              ["group", "Summary", BarChart3],
              ["list", "Detailed list", Table2],
            ] as const
          ).map(([k, l, I]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold ${mode === k ? "bg-hive-700 text-white" : "text-ink-700 hover:bg-hive-50"}`}>
              <I className="h-4 w-4" /> {l}
            </button>
          ))}
        </div>

        {mode === "group" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Group by" className="col-span-2">
              <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                {def?.fields.filter((f) => f.type !== "number").map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            {def?.fields.find((f) => f.key === groupBy)?.type === "date" && (
              <Field label="Per">
                <select className="input" value={bucket} onChange={(e) => setBucket(e.target.value)}>
                  {["day", "week", "month", "year"].map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Measure" className={def?.fields.find((f) => f.key === groupBy)?.type === "date" ? "" : "col-span-2"}>
              <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
                <option value="count">Count of records</option>
                {numFields.flatMap((f) =>
                  ["sum", "avg", "max"].map((op) => (
                    <option key={`${op}:${f.key}`} value={`${op}:${f.key}`}>
                      {op === "sum" ? "Total" : op === "avg" ? "Average" : "Max"} {f.label}
                    </option>
                  ))
                )}
              </select>
            </Field>
          </div>
        ) : (
          <div>
            <p className="label">Columns</p>
            <div className="flex flex-wrap gap-1.5">
              {def?.fields.map((f) => {
                const on = cols.includes(f.key);
                return (
                  <button key={f.key} type="button" aria-pressed={on} onClick={() => setCols(on ? cols.filter((c) => c !== f.key) : [...cols, f.key])} className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${on ? "border-hive-700 bg-hive-700 text-white" : "border-ink-400/25 bg-white text-ink-700 hover:bg-hive-50"}`}>
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="To">
            <input type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
          {base === "/sa" && def?.key !== "companies" && (
            <Field label="Company" className="col-span-2">
              <select className="input" value={range.companyId} onChange={(e) => setRange({ ...range, companyId: e.target.value })}>
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div>
          <p className="label">Filters</p>
          <div className="space-y-2">
            {filters.map((fl, i) => {
              const f = def?.fields.find((x) => x.key === fl.field);
              const ops = OPS[f?.type || "string"];
              const upd = (p: any) => setFilters(filters.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={i} className="flex gap-1.5">
                  <select className="input px-2 text-xs" value={fl.field} onChange={(e) => upd({ field: e.target.value, op: OPS[def?.fields.find((x) => x.key === e.target.value)?.type || "string"][0].v, value: "" })} aria-label="Field">
                    {def?.fields.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <select className="input w-24 px-2 text-xs" value={fl.op} onChange={(e) => upd({ op: e.target.value })} aria-label="Condition">
                    {ops.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.l}
                      </option>
                    ))}
                  </select>
                  {fl.op !== "exists" &&
                    (f?.type === "enum" && fl.op !== "in" ? (
                      <select className="input px-2 text-xs" value={fl.value} onChange={(e) => upd({ value: e.target.value })} aria-label="Value">
                        <option value="">—</option>
                        {f.options?.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="input px-2 text-xs" type={f?.type === "date" ? "date" : f?.type === "number" ? "number" : "text"} value={fl.value} onChange={(e) => upd({ value: e.target.value })} aria-label="Value" />
                    ))}
                  <button className="btn-ghost px-1.5" onClick={() => setFilters(filters.filter((_, j) => j !== i))} aria-label="Remove filter">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
          <button className="mt-2 flex items-center gap-1 text-sm font-semibold text-hive-700" onClick={() => setFilters([...filters, { field: def!.fields[0].key, op: OPS[def!.fields[0].type][0].v, value: "" }])}>
            <Plus className="h-4 w-4" /> Add filter
          </button>
        </div>

        <Btn className="w-full" loading={busy} onClick={run} disabled={mode === "list" && !cols.length}>
          <Play className="h-4 w-4" /> Run report
        </Btn>
      </div>

      <div className="min-w-0">{report ? <ReportResult base={base} report={report} /> : <div className="card"><Empty title="Build your report" hint="Pick the data, choose a summary or a detailed list, add filters and press Run. Export to Excel or CSV from the result." /></div>}</div>
    </div>
  );
}

const IDEAS = ["Leads per source this month with conversion", "Daily new leads for the last 30 days", "Lost leads by reason this quarter", "Leads not contacted in the last 7 days", "WhatsApp messages that failed this week, by event"];

/** Agentic report: an AI agent turns a request into a read-only report. */
export function AgenticReport() {
  const [agents, setAgents] = useState<any[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const toast = useToast();
  useEffect(() => {
    api("/co/ai-agents")
      .then((l) => {
        const active = l.filter((a: any) => a.active !== false);
        setAgents(active);
        setAgentId(active.find((a: any) => a.isAssistant)?._id || active[0]?._id || "");
      })
      .catch(() => setAgents([]));
  }, []);

  async function go() {
    setBusy(true);
    try {
      setReport(await api("/co/reports/agentic", { body: { agentId, prompt } }));
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!agents)
    return (
      <div className="flex justify-center py-20 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  if (!agents.length) return <div className="card"><Empty title="No AI agent yet" hint="Create one under Settings › AI Agent, then come back to ask for reports in plain language." /></div>;

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-hive-800 to-hive-950 px-6 py-5 text-white">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Sparkles className="h-4 w-4 text-honey-300" /> Ask for any report or dashboard
          </p>
          <p className="mt-1 text-sm text-white/70">The agent reads your data in read-only mode — it can’t change anything. Uses AI credits.</p>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
            <Field label="AI agent">
              <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What do you want to see?">
              <textarea className="input min-h-[52px]" rows={2} value={prompt} placeholder="e.g. Leads per source this month, and which source converts best" onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim().length > 3 && go()} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {IDEAS.map((i) => (
              <button key={i} onClick={() => setPrompt(i)} className="rounded-full border border-ink-400/20 bg-white px-3 py-1 text-xs font-semibold text-ink-700 hover:border-hive-400 hover:bg-hive-50">
                {i}
              </button>
            ))}
            <Btn className="ml-auto" loading={busy} disabled={prompt.trim().length < 4 || !agentId} onClick={go}>
              <Wand2 className="h-4 w-4" /> Generate
            </Btn>
          </div>
        </div>
      </div>
      {busy && !report && (
        <div className="card flex items-center gap-3 p-6 text-sm text-ink-500">
          <Spinner /> Reading your data and building the report…
        </div>
      )}
      {report && <ReportResult base="/co" report={report} />}
      {report && (
        <p className="text-xs text-ink-400">
          <Badge>Read-only</Badge> <span className="ml-1">Generated from: {report.spec?.dataset} · {JSON.stringify(report.spec?.groupBy || report.spec?.columns || [])}</span>
        </p>
      )}
    </div>
  );
}

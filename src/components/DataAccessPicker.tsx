"use client";
import { Database, ShieldCheck, Check } from "lucide-react";

export type DataTable = { key: string; label: string; module: string; fields: string[]; count: number | null };

const GROUP: Record<string, string> = { leads: "Leads", clients: "Client", wa_logs: "WhatsApp", activity_logs: "Logs", ai_agents: "AI" };

/**
 * Edit AI agent › Data access. Lists ONLY the signed-in company's own tables (served by /co/ai-agents/data-tables,
 * counted in that company's database) — another company's tables are never fetched or shown.
 */
export function DataAccessPicker({ tables, value, onChange, company }: { tables: DataTable[] | null; value: string[]; onChange: (v: string[]) => void; company?: string }) {
  const all = tables?.map((t) => t.key) || [];
  const on = (k: string) => value.includes(k);
  const toggle = (k: string) => onChange(on(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="label mb-0">Data access</p>
        {!!tables?.length && (
          <div className="flex gap-3 text-xs font-semibold">
            <button type="button" className="text-hive-700 hover:underline" onClick={() => onChange(all)}>
              Select all
            </button>
            <button type="button" className="text-ink-500 hover:underline" onClick={() => onChange([])}>
              None
            </button>
          </div>
        )}
      </div>
      <p className="mb-2 mt-1 flex items-start gap-1.5 text-xs text-ink-500">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span>
          Read-only. The agent can read only the tables ticked here, and only {company ? <b className="text-ink-700">{company}</b> : "your company"}’s own records — other companies’ data is never visible.
        </span>
      </p>
      <div className="overflow-hidden rounded-2xl border border-ink-400/15">
        {!tables && <div className="px-4 py-5 text-sm text-ink-400">Loading your tables…</div>}
        {tables && !tables.length && <div className="px-4 py-5 text-sm text-ink-500">No data tables are available to you. Your role needs read access to Leads or Client.</div>}
        {tables?.map((t, i) => (
          <label key={t.key} className={`flex cursor-pointer items-start gap-3 px-3.5 py-3 transition ${i ? "border-t border-ink-400/10" : ""} ${on(t.key) ? "bg-hive-50/70" : "hover:bg-ink-400/5"}`}>
            <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border ${on(t.key) ? "border-hive-700 bg-hive-700 text-white" : "border-ink-400/40 bg-white"}`}>
              {on(t.key) && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <input type="checkbox" className="sr-only" checked={on(t.key)} onChange={() => toggle(t.key)} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
                <Database className="h-3.5 w-3.5 text-hive-600" />
                {t.label}
                <span className="rounded-full bg-ink-400/10 px-2 py-px text-[11px] font-medium text-ink-500">{GROUP[t.module] || t.module}</span>
                {t.count != null && <span className="ml-auto text-xs font-medium text-ink-500">{t.count.toLocaleString("en-IN")} records</span>}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-400" title={t.fields.join(", ")}>
                {t.fields.join(" · ")}
              </span>
            </span>
          </label>
        ))}
      </div>
      {tables && tables.length > 0 && value.length === 0 && <p className="mt-1.5 text-xs text-amber-700">No tables selected — the agent will answer only from its knowledge base and prompts.</p>}
    </div>
  );
}

/** Short summary for the agents list. */
export function dataAccessLabel(a: any, tables: DataTable[] | null) {
  if (!Array.isArray(a.dataAccess)) return "All tables";
  if (!a.dataAccess.length) return "None";
  const names = a.dataAccess.map((k: string) => tables?.find((t) => t.key === k)?.label || k);
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

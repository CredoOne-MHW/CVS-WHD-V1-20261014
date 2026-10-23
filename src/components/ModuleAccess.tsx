"use client";
import { Fragment, useEffect, useState } from "react";
import { PauseCircle, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Spinner } from "./ui";
import { permRows, type ModuleAccess, type ModuleDef, type Perm, type Action } from "@shared/constants";

const ACTIONS: Action[] = ["create", "read", "update", "delete"];
type Row = { key: string; label: string; group?: string; parent?: string; actions?: Action[] };

/**
 * Super Admin › Company › Modules. Every module and sub-module comes from the registry, so new ones appear here
 * automatically. Default = what the plan gives; “Custom” restricts (or extends) the CRUD for this company only;
 * “Paused” switches the module off for the company (its data stays).
 */
export function ModuleAccessGrid({ plan, value, onChange, disabled }: { plan: string; value: ModuleAccess; onChange: (v: ModuleAccess) => void; disabled?: boolean }) {
  const [d, setD] = useState<{ modules: ModuleDef[]; caps: Record<string, Perm> } | null>(null);
  useEffect(() => {
    setD(null);
    api(`/sa/companies/plan-caps?plan=${encodeURIComponent(plan)}`).then(setD);
  }, [plan]);
  if (!d)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const rows: Row[] = permRows(d.modules);
  const applies = (r: Row, a: Action) => !r.parent || !!r.actions?.includes(a);
  const planPerm = (r: Row): Perm => {
    const k = r.parent || r.key;
    const p = d.caps[k] || ({} as Perm);
    return Object.fromEntries(ACTIONS.map((a) => [a, !!p[a] && applies(r, a)])) as Perm;
  };
  /** module's effective permission (sub-modules can't go beyond it) */
  const moduleEff = (key: string): Perm => {
    const o = value[key];
    if (o?.mode === "paused") return { create: false, read: false, update: false, delete: false };
    if (o?.mode === "custom") return o.perm;
    return planPerm({ key, label: "" });
  };
  const eff = (r: Row): Perm => {
    const o = value[r.key];
    if (o?.mode === "paused") return { create: false, read: false, update: false, delete: false };
    if (!r.parent) return moduleEff(r.key);
    const m = moduleEff(r.parent);
    return Object.fromEntries(ACTIONS.map((a) => [a, applies(r, a) && !!m[a] && (o?.mode === "custom" ? !!o.perm[a] : true)])) as Perm;
  };
  const mode = (r: Row) => value[r.key]?.mode || "plan";
  const setMode = (r: Row, m: string) => {
    const n = { ...value };
    if (m === "plan") delete n[r.key];
    else if (m === "paused") n[r.key] = { mode: "paused" };
    // Custom starts from what the row gives today, then the Super Admin unticks / ticks
    else n[r.key] = { mode: "custom", perm: r.parent ? (Object.fromEntries(ACTIONS.map((a) => [a, applies(r, a)])) as Perm) : { ...moduleEff(r.key), ...(value[r.key]?.mode === "paused" ? planPerm(r) : {}) } };
    onChange(n);
  };
  const toggle = (r: Row, a: Action, v: boolean) => {
    const cur = value[r.key]?.mode === "custom" ? { ...(value[r.key] as any).perm } : { ...eff(r) };
    cur[a] = v;
    if (a !== "read" && v) cur.read = applies(r, "read") ? true : cur.read;
    if (a === "read" && !v) ACTIONS.forEach((x) => (cur[x] = false));
    onChange({ ...value, [r.key]: { mode: "custom", perm: cur } });
  };
  const overrides = Object.keys(value).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-hive-50/70 p-3 text-[13px] text-ink-700">
        <p className="min-w-0 flex-1">
          Starts from the <b>{plan}</b> plan. Change a row to <b>Custom</b> to restrict (or extend) it for this company, or <b>Paused</b> to switch it off — the company sees it as paused and its data is kept. Roles inside the company can never exceed this.
        </p>
        {overrides > 0 && !disabled && (
          <button type="button" className="inline-flex items-center gap-1.5 font-semibold text-hive-700 hover:text-hive-900" onClick={() => onChange({})}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset all to plan ({overrides})
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-ink-400/15">
        <table className="w-full min-w-[680px]">
          <thead>
            <tr>
              <th className="th">Module</th>
              <th className="th">Access</th>
              {ACTIONS.map((a) => (
                <th key={a} className="th text-center capitalize">
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = mode(r);
              const e = eff(r);
              const sub = !!r.parent;
              const parentPaused = sub && value[r.parent!]?.mode === "paused";
              return (
                <Fragment key={r.key}>
                  <tr className={m === "paused" || parentPaused ? "bg-red-50/50" : sub ? "bg-ink-400/[0.03]" : ""}>
                    <td className={sub ? "td py-2 pl-9" : "td"}>
                      {sub ? (
                        <span className="text-sm text-ink-500">
                          <span className="mr-1.5 text-ink-400">↳</span>
                          {r.label}
                        </span>
                      ) : (
                        <span className="font-semibold">{r.label}</span>
                      )}
                      {m === "paused" && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                          <PauseCircle className="h-3 w-3" /> Paused
                        </span>
                      )}
                    </td>
                    <td className={sub ? "td py-2" : "td"}>
                      <select className="input w-auto py-1.5 text-sm" value={m} disabled={disabled || parentPaused} onChange={(ev) => setMode(r, ev.target.value)} aria-label={`${r.label} access`}>
                        <option value="plan">{sub ? "Follows module" : "Plan default"}</option>
                        <option value="custom">Custom</option>
                        <option value="paused">Paused</option>
                      </select>
                    </td>
                    {ACTIONS.map((a) => (
                      <td key={a} className={sub ? "td py-2 text-center" : "td text-center"}>
                        {sub && !applies(r, a) ? (
                          <span className="text-ink-400">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-hive-700 disabled:opacity-40"
                            checked={!!e[a]}
                            disabled={disabled || m !== "custom" || (sub && !moduleEff(r.parent!)[a])}
                            onChange={(ev) => toggle(r, a, ev.target.checked)}
                            aria-label={`${r.label} ${a}`}
                            title={m !== "custom" ? "Choose Custom to change" : undefined}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

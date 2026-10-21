"use client";
import { Fragment } from "react";
import { permRows, type PermMap, type Perm, type Action, type ModuleDef } from "@shared/constants";

const ACTIONS: (keyof Perm)[] = ["create", "read", "update", "delete"];
const NONE: Perm = { create: false, read: false, update: false, delete: false };

type Row = { key: string; label: string; group?: string; parent?: string; actions?: Action[] };

/**
 * Module × CRUD grid. Rows come from the module registry, so any newly added
 * Company module — and its sub-modules — appears here automatically.
 *
 * - `caps` greys out what the plan doesn't allow.
 * - `withSubs` adds an indented row per sub-module. A sub-module only offers the
 *   actions that apply to it ("—" otherwise), can never exceed its module, and
 *   follows the module until it is changed on its own.
 */
export function PermGrid({ modules, value, onChange, caps, disabled, withSubs }: { modules: (ModuleDef | { key: string; label: string; group?: string })[]; value: PermMap; onChange: (v: PermMap) => void; caps?: PermMap | null; disabled?: boolean; withSubs?: boolean }) {
  const rows: Row[] = withSubs ? permRows(modules as ModuleDef[]) : (modules as Row[]);
  const parents = rows.filter((r) => !r.parent);

  const applicable = (r: Row, a: keyof Perm) => !r.parent || !!r.actions?.includes(a as Action);
  const capOk = (k: string, a: keyof Perm) => !caps || !!caps[k]?.[a];
  /** Can this box be ticked at all? */
  const allowed = (r: Row, a: keyof Perm) => (r.parent ? applicable(r, a) && capOk(r.parent, a) && !!value?.[r.parent]?.[a] : capOk(r.key, a));
  /** What the role effectively gets (subs inherit from the module unless set). */
  const get = (r: Row, a: keyof Perm): boolean => {
    if (!r.parent) return !!value?.[r.key]?.[a];
    if (!allowed(r, a)) return false;
    const own = value?.[r.key];
    return own ? !!own[a] : true;
  };
  const effective = (r: Row): Perm => Object.fromEntries(ACTIONS.map((a) => [a, get(r, a)])) as unknown as Perm;

  const fix = (r: Row, cur: Perm): Perm => {
    for (const a of ACTIONS) if (!allowed(r, a)) cur[a] = false;
    return cur;
  };

  const set = (r: Row, a: keyof Perm, v: boolean) => {
    const cur: Perm = r.parent ? effective(r) : Object.assign({ ...NONE }, value[r.key]);
    cur[a] = v;
    if (a !== "read" && v) cur.read = true; // write implies read
    if (a === "read" && !v) cur.create = cur.update = cur.delete = false;
    onChange({ ...value, [r.key]: r.parent ? fix(r, cur) : cur });
  };
  const setRow = (r: Row, v: boolean) => {
    const next: PermMap = { ...value, [r.key]: Object.fromEntries(ACTIONS.map((a) => [a, v && allowed(r, a)])) as unknown as Perm };
    // Ticking/unticking a whole module resets its sub-modules to follow it.
    if (!r.parent) for (const s of rows) if (s.parent === r.key) delete next[s.key];
    onChange(next);
  };
  const setCol = (a: keyof Perm, v: boolean) => {
    const next = { ...value };
    for (const r of parents) {
      const cur: Perm = Object.assign({ ...NONE }, next[r.key]);
      cur[a] = v && capOk(r.key, a);
      if (v && a !== "read" && cur[a]) cur.read = true;
      if (!v && a === "read") cur.create = cur.update = cur.delete = false;
      next[r.key] = cur;
      for (const s of rows) if (s.parent === r.key) delete next[s.key];
    }
    onChange(next);
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-400/15">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr>
            <th className="th">Module</th>
            {ACTIONS.map((a) => (
              <th key={a} className="th text-center">
                <label className="inline-flex cursor-pointer flex-col items-center gap-1">
                  <span className="capitalize">{a}</span>
                  <input type="checkbox" className="h-4 w-4 accent-hive-700" disabled={disabled} checked={parents.every((r) => !capOk(r.key, a) || get(r, a))} onChange={(e) => setCol(a, e.target.checked)} aria-label={`All ${a}`} />
                </label>
              </th>
            ))}
            <th className="th text-center">All</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sub = !!r.parent;
            const custom = sub && !!value?.[r.key];
            return (
              <Fragment key={r.key}>
                <tr className={sub ? "bg-ink-400/[0.03] hover:bg-hive-50/40" : "hover:bg-hive-50/40"}>
                  <td className={sub ? "td py-2 pl-9" : "td"}>
                    {sub ? (
                      <span className="text-sm text-ink-600">
                        <span className="mr-1.5 text-ink-400">↳</span>
                        {r.label}
                        {custom ? (
                          <button type="button" disabled={disabled} className="ml-2 text-[11px] font-semibold text-hive-700 hover:underline disabled:opacity-40" onClick={() => { const n = { ...value }; delete n[r.key]; onChange(n); }} title="Follow the module's permissions again">
                            reset
                          </button>
                        ) : (
                          <span className="ml-2 text-[11px] text-ink-400">follows module</span>
                        )}
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold">{r.label}</span>
                        {r.group && <span className="ml-2 text-xs text-ink-400">{r.group}</span>}
                      </>
                    )}
                  </td>
                  {ACTIONS.map((a) => (
                    <td key={a} className={sub ? "td py-2 text-center" : "td text-center"}>
                      {sub && !applicable(r, a) ? (
                        <span className="text-ink-300" title={`${a} does not apply to ${r.label}`}>—</span>
                      ) : (
                        <input
                          type="checkbox"
                          className={`${sub ? "h-4 w-4" : "h-[18px] w-[18px]"} accent-hive-700 disabled:opacity-30`}
                          disabled={disabled || !allowed(r, a)}
                          checked={get(r, a)}
                          onChange={(e) => set(r, a, e.target.checked)}
                          aria-label={`${r.label} ${a}`}
                          title={!allowed(r, a) ? (sub ? "Give the module this access first" : "Not included in the plan") : undefined}
                        />
                      )}
                    </td>
                  ))}
                  <td className={sub ? "td py-2 text-center" : "td text-center"}>
                    <input type="checkbox" className={`${sub ? "h-4 w-4" : "h-[18px] w-[18px]"} accent-honey-500 disabled:opacity-30`} disabled={disabled || ACTIONS.every((a) => !allowed(r, a))} checked={ACTIONS.some((a) => allowed(r, a)) && ACTIONS.every((a) => !allowed(r, a) || get(r, a))} onChange={(e) => setRow(r, e.target.checked)} aria-label={`${r.label} all`} />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

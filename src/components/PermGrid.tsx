"use client";
import type { PermMap, Perm } from "@shared/constants";

const ACTIONS: (keyof Perm)[] = ["create", "read", "update", "delete"];

/**
 * Module × CRUD grid. Rows come from the module registry, so any newly added
 * Company module appears here automatically. `caps` greys out what the plan doesn't allow.
 */
export function PermGrid({ modules, value, onChange, caps, disabled }: { modules: { key: string; label: string; group?: string }[]; value: PermMap; onChange: (v: PermMap) => void; caps?: PermMap | null; disabled?: boolean }) {
  const get = (m: string, a: keyof Perm) => !!value?.[m]?.[a];
  const allowed = (m: string, a: keyof Perm) => !caps || !!caps[m]?.[a];
  const set = (m: string, a: keyof Perm, v: boolean) => {
    const cur: Perm = Object.assign({ create: false, read: false, update: false, delete: false }, value[m]);
    cur[a] = v;
    if (a !== "read" && v) cur.read = true; // write implies read
    if (a === "read" && !v) cur.create = cur.update = cur.delete = false;
    onChange({ ...value, [m]: cur });
  };
  const setRow = (m: string, v: boolean) => onChange({ ...value, [m]: Object.fromEntries(ACTIONS.map((a) => [a, v && allowed(m, a)])) as unknown as Perm });
  const setCol = (a: keyof Perm, v: boolean) => {
    const next = { ...value };
    for (const m of modules) {
      const cur: Perm = Object.assign({ create: false, read: false, update: false, delete: false }, next[m.key]);
      cur[a] = v && allowed(m.key, a);
      if (v && a !== "read" && cur[a]) cur.read = true;
      next[m.key] = cur;
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
                  <input type="checkbox" className="h-4 w-4 accent-hive-700" disabled={disabled} checked={modules.every((m) => !allowed(m.key, a) || get(m.key, a))} onChange={(e) => setCol(a, e.target.checked)} aria-label={`All ${a}`} />
                </label>
              </th>
            ))}
            <th className="th text-center">All</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m.key} className="hover:bg-hive-50/40">
              <td className="td">
                <span className="font-semibold">{m.label}</span>
                {m.group && <span className="ml-2 text-xs text-ink-400">{m.group}</span>}
              </td>
              {ACTIONS.map((a) => (
                <td key={a} className="td text-center">
                  <input type="checkbox" className="h-[18px] w-[18px] accent-hive-700 disabled:opacity-30" disabled={disabled || !allowed(m.key, a)} checked={get(m.key, a)} onChange={(e) => set(m.key, a, e.target.checked)} aria-label={`${m.label} ${a}`} title={!allowed(m.key, a) ? "Not included in the plan" : undefined} />
                </td>
              ))}
              <td className="td text-center">
                <input type="checkbox" className="h-[18px] w-[18px] accent-honey-500" disabled={disabled} checked={ACTIONS.every((a) => !allowed(m.key, a) || get(m.key, a))} onChange={(e) => setRow(m.key, e.target.checked)} aria-label={`${m.label} all`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

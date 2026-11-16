"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { ShieldCheck, Plus, Trash2, Timer, Play, Save, CalendarClock, Bell, Upload, Volume2, X, RotateCcw, AlertTriangle, Database } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Field, Btn, Badge, Spinner, Empty, Confirm, useToast } from "@/components/ui";
import { PermGrid } from "@/components/PermGrid";
import { cronText, retainText, RETAIN_CHOICES, NOTIFY_KINDS, NOTIFY_SOUNDS, notifyOf, type CronUnit } from "@shared/platform";
import type { PermMap, ModuleDef } from "@shared/constants";

const ago = (d?: string | Date | null) => {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (Math.abs(s) < 60) return s >= 0 ? "now" : "in a moment";
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return m > 0 ? `${m} min ago` : `in ${-m} min`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return h > 0 ? `${h} h ago` : `in ${-h} h`;
  return fmtDate(d, false);
};

/* ───────────────────────── Role access ─────────────────────────
 * The company's own roles, edited by Super Admin. Everything is capped by the plan and by the Modules tab,
 * so a paused module can never be granted here.
 */

export function RoleAccessTab({ id, companyName }: { id: string; companyName: string }) {
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<string>("");
  const [perms, setPerms] = useState<PermMap>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<any>(null);
  const toast = useToast();

  const load = useCallback(
    (keep?: string) =>
      api(`/sa/companies/${id}/roles`).then((r) => {
        setD(r);
        const pick = keep || sel || r.roles[0]?._id || "";
        setSel(pick);
        setPerms((r.roles.find((x: any) => x._id === pick)?.permissions || {}) as PermMap);
      }),
    [id, sel]
  );
  useEffect(() => {
    api(`/sa/companies/${id}/roles`).then((r) => {
      setD(r);
      setSel(r.roles[0]?._id || "");
      setPerms((r.roles[0]?.permissions || {}) as PermMap);
    });
  }, [id]);

  if (!d)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const role = d.roles.find((r: any) => r._id === sel);

  async function save() {
    if (!role) return;
    setBusy(true);
    try {
      await api(`/sa/companies/${id}/roles/${role._id}`, { method: "PUT", body: { permissions: perms } });
      toast("ok", `${role.name} saved — Super Admin now sets this role`);
      await load(role._id);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (name.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await api(`/sa/companies/${id}/roles`, { body: { name: name.trim(), permissions: {} } });
      setName("");
      toast("ok", "Role added");
      await load(r._id);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-honey-500/30 bg-honey-500/10 p-4 text-sm text-ink-700">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-honey-700" />
        <p>
          Nobody in <b>{companyName}</b> — the owner included — can open a screen or change anything unless it is ticked here for their role. The server checks this on every request. Roles the company creates itself can only use what the plan and the <b>Modules</b> tab allow. <b>Force login</b> always has full access.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Role" className="min-w-[240px]">
          <select
            className="input"
            value={sel}
            onChange={(e) => {
              setSel(e.target.value);
              setPerms((d.roles.find((x: any) => x._id === e.target.value)?.permissions || {}) as PermMap);
            }}
          >
            {d.roles.map((r: any) => (
              <option key={r._id} value={r._id}>
                {r.name} · {r.users} user(s) · set by {r.setBy === "super" ? "Super Admin" : "the company"}
              </option>
            ))}
            {!d.roles.length && <option value="">No roles yet</option>}
          </select>
        </Field>
        <Field label="New role" className="min-w-[200px]">
          <input className="input" placeholder="e.g. Tele-caller" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        </Field>
        <Btn type="button" variant="secondary" onClick={add} loading={busy}>
          <Plus className="h-4 w-4" /> Add
        </Btn>
        <div className="ml-auto flex gap-2">
          {role && (
            <Btn type="button" variant="ghost" onClick={() => setDel(role)}>
              <Trash2 className="h-4 w-4" /> Delete role
            </Btn>
          )}
          <Btn type="button" onClick={save} loading={busy} disabled={!role}>
            <Save className="h-4 w-4" /> Save role
          </Btn>
        </div>
      </div>

      {d.paused?.length > 0 && (
        <p className="text-xs text-ink-500">
          Paused for this company (cannot be granted): <b>{d.paused.join(", ")}</b>
        </p>
      )}

      {role ? <PermGrid modules={d.modules as ModuleDef[]} value={perms} onChange={setPerms} caps={d.planCaps} withSubs /> : <Empty title="No roles yet" hint="Add one above — the company's own Role Management shows the same grid." />}

      <Confirm
        open={!!del}
        danger
        title="Delete role?"
        body={`${del?.name} will be removed from ${companyName}. Move its users to another role first.`}
        confirmLabel="Delete"
        onClose={() => setDel(null)}
        onConfirm={async () => {
          try {
            await api(`/sa/companies/${id}/roles/${del._id}`, { method: "DELETE" });
            toast("ok", "Role deleted");
            setSel("");
            await load();
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </div>
  );
}

/* ───────────────────────── Cron Jobs ───────────────────────── */

export function CronTab({ id, companyName }: { id: string; companyName: string }) {
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState("");
  const toast = useToast();

  const load = useCallback(() => api(`/sa/companies/${id}/cron`).then((r) => setJobs(r.jobs)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!jobs)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const cur = (j: any) => ({ ...j.setting, ...(edit[j.key] || {}) });
  const touch = (k: string, patch: any) => setEdit((e) => ({ ...e, [k]: { ...(e[k] || {}), ...patch } }));
  const dirty = Object.keys(edit).length > 0;

  async function save() {
    setBusy("save");
    try {
      const cron: Record<string, any> = {};
      for (const j of jobs!) cron[j.key] = cur(j);
      const r = await api(`/sa/companies/${id}/cron`, { method: "PUT", body: { cron } });
      setJobs(r.jobs);
      setEdit({});
      toast("ok", "Schedules saved — they apply from the next beat");
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }
  async function run(j: any) {
    setBusy(j.key);
    try {
      const r = await api(`/sa/companies/${id}/cron/${j.key}/run`, { method: "POST" });
      setJobs(r.jobs);
      toast("ok", `${j.label} ran`);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-hive-50/70 p-4 text-sm text-ink-700">
        <p className="flex min-w-0 flex-1 items-start gap-3">
          <Timer className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
          <span>
            Background jobs for <b>{companyName}</b>. A change applies from the job’s next beat. Daily jobs run at the set time, India time. New jobs added to the platform appear here automatically. Jobs marked <b>platform-wide</b> run once for every company on the platform’s own schedule — you can still run one for this company now.
          </span>
        </p>
        {dirty && (
          <Btn type="button" onClick={save} loading={busy === "save"}>
            <Save className="h-4 w-4" /> Save schedules
          </Btn>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-ink-400/15">
        <table className="w-full min-w-[920px]">
          <thead>
            <tr>
              {["Job", "Schedule", "Last run", "Next run", "On", ""].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const s = cur(j);
              return (
                <tr key={j.key} className="align-top hover:bg-hive-50/40">
                  <td className="td">
                    <p className="font-semibold">
                      {j.label} {!j.perCompany && <Badge color="gray">platform-wide</Badge>}
                    </p>
                    <p className="max-w-[420px] text-xs text-ink-500">{j.description}</p>
                    <p className="mono text-[11px] text-ink-400">{j.key}</p>
                  </td>
                  <td className="td">
                    {s.unit === "daily" ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-500">Daily at</span>
                        <input className="input w-[120px] py-1.5" type="time" value={s.at} disabled={!j.perCompany} onChange={(e) => touch(j.key, { at: e.target.value })} />
                        <span className="text-xs text-ink-500">IST</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-500">Every</span>
                        <input className="input w-[70px] py-1.5" inputMode="numeric" value={s.every} disabled={!j.perCompany} onChange={(e) => touch(j.key, { every: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} />
                        <select className="input w-auto py-1.5" value={s.unit} disabled={!j.perCompany} onChange={(e) => touch(j.key, { unit: e.target.value as CronUnit })}>
                          <option value="minutes">minutes</option>
                          <option value="hours">hours</option>
                          <option value="daily">daily</option>
                        </select>
                      </div>
                    )}
                    <p className="mt-1 text-xs text-ink-400">
                      Default: {cronText({ unit: j.unit, every: j.every || 1, at: j.at || "02:00" })}
                      {j.custom && " · changed"}
                    </p>
                  </td>
                  <td className="td whitespace-nowrap text-sm">
                    {j.last ? (
                      <>
                        <p className={j.last.ok ? "" : "font-semibold text-red-600"}>{ago(j.last.at)}</p>
                        <p className="text-xs text-ink-400">{j.last.ok ? `${j.last.ms} ms` : j.last.error?.slice(0, 40)}</p>
                      </>
                    ) : (
                      <span className="text-ink-400">never</span>
                    )}
                  </td>
                  <td className="td whitespace-nowrap text-sm text-ink-600">{s.on ? ago(j.next) : <span className="text-ink-400">off</span>}</td>
                  <td className="td">
                    <label className="inline-flex cursor-pointer items-center">
                      <input type="checkbox" className="peer sr-only" checked={s.on} disabled={!j.perCompany} onChange={(e) => touch(j.key, { on: e.target.checked })} aria-label={`${j.label} on`} />
                      <span className="relative h-6 w-11 rounded-full bg-ink-400/30 transition peer-checked:bg-hive-700 peer-disabled:opacity-40 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
                    </label>
                  </td>
                  <td className="td text-right">
                    <Btn type="button" variant="secondary" loading={busy === j.key} onClick={() => run(j)} title="Run this company's share now">
                      <Play className="h-3.5 w-3.5" /> Run now
                    </Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────────────────── Retention Policy ───────────────────────── */

export function RetentionTab({ id, companyName }: { id: string; companyName: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const toast = useToast();

  const load = useCallback(() => api(`/sa/companies/${id}/retention`).then((r) => setRows(r.rows)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!rows)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  const dirty = Object.keys(edit).length > 0;

  async function save() {
    setBusy("save");
    try {
      const retention: Record<string, number> = {};
      for (const r of rows!) retention[r.key] = edit[r.key] ?? r.days;
      const out = await api(`/sa/companies/${id}/retention`, { method: "PUT", body: { retention } });
      setRows(out.rows);
      setEdit({});
      toast("ok", "Retention saved");
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }
  async function apply(kind?: string) {
    setBusy(kind || "all");
    try {
      const out = await api(`/sa/companies/${id}/retention/apply${kind ? `?kind=${kind}` : ""}`, { method: "POST" });
      setRows(out.rows);
      const n = Object.values(out.removed || {}).reduce((a: number, x: any) => a + x, 0);
      toast("ok", n ? `${n} record(s) deleted` : "Nothing was old enough to delete");
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-hive-50/70 p-4 text-sm text-ink-700">
        <p className="flex min-w-0 flex-1 items-start gap-3">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
          <span>
            How long each log of <b>{companyName}</b> is kept. New kinds of log appear here automatically. Records past their period are deleted by the nightly housekeeping job — or at once with <b>Apply</b>. Some logs have a floor, so an audit always has something to read.
          </span>
        </p>
        <div className="flex gap-2">
          <Btn type="button" variant="secondary" loading={busy === "all"} onClick={() => apply()}>
            <Play className="h-4 w-4" /> Apply now
          </Btn>
          {dirty && (
            <Btn type="button" onClick={save} loading={busy === "save"}>
              <Save className="h-4 w-4" /> Save
            </Btn>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-ink-400/15">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr>
              {["Log", "Records", "Oldest", "Keep for", ""].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-hive-50/40">
                <td className="td">
                  <p className="font-semibold">{r.label}</p>
                  <p className="max-w-[420px] text-xs text-ink-500">{r.description}</p>
                  <p className="mono text-[11px] text-ink-400">
                    {r.key} · default {retainText(r.defaultDays)}
                    {r.minDays ? ` · never below ${r.minDays} days` : ""}
                  </p>
                </td>
                <td className="td tabular-nums">{r.records.toLocaleString("en-IN")}</td>
                <td className="td whitespace-nowrap text-ink-500">{r.oldest ? fmtDate(r.oldest, false) : "—"}</td>
                <td className="td">
                  <select className="input w-[160px] py-1.5" value={edit[r.key] ?? r.days} onChange={(e) => setEdit((x) => ({ ...x, [r.key]: Number(e.target.value) }))}>
                    {RETAIN_CHOICES.filter((d) => d === 0 || !r.minDays || d >= r.minDays).map((d) => (
                      <option key={d} value={d}>
                        {retainText(d)}
                      </option>
                    ))}
                  </select>
                  {r.custom && <p className="mt-1 text-[11px] text-hive-700">changed</p>}
                </td>
                <td className="td text-right">
                  <Btn type="button" variant="ghost" loading={busy === r.key} onClick={() => apply(r.key)}>
                    Apply
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-500">Deleted records cannot be brought back. A deleted client is archived separately and is not touched by these periods.</p>
    </div>
  );
}

/* ───────────────────────── Notifications ───────────────────────── */

export function NotificationsTab({ id, form, set }: { id: string; form: any; set: (k: string, v: any) => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const sounds: any[] = form.branding?.sounds || [];
  const notify = form.notify || {};
  const one = form.notifySound || "";

  const setRow = (key: string, patch: any) => set("notify", { ...notify, [key]: { ...notifyOf(NOTIFY_KINDS.find((n) => n.key === key)!, notify[key]), ...patch } });
  const allCol = (device: "mobile" | "desktop", v: boolean) => {
    const next: any = { ...notify };
    for (const n of NOTIFY_KINDS) next[n.key] = { ...notifyOf(n, notify[n.key]), [device]: v };
    set("notify", next);
  };

  async function upload(file?: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api(`/sa/companies/${id}/sound`, { form: fd });
      set("branding", { ...form.branding, sounds: r.sounds });
      toast("ok", "Sound uploaded");
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  const choices = [...NOTIFY_SOUNDS.map((s) => ({ key: s, name: `${s[0].toUpperCase()}${s.slice(1)} (default)` })), ...sounds.map((s) => ({ key: s.key, name: s.name }))];
  const groups = Array.from(new Set(NOTIFY_KINDS.map((n) => n.group)));

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl bg-hive-50/70 p-4 text-sm text-ink-700">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
        <p>Choose which notifications this company’s apps show on each kind of device, and the sound for each. New notifications appear in this list automatically.</p>
      </div>

      <label className="flex items-start gap-3 rounded-2xl border border-ink-400/15 bg-white p-4">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={!!one} onChange={(e) => set("notifySound", e.target.checked ? "chime" : "")} />
        <span className="text-sm">
          <b>Apply one sound to all</b>
          <span className="block text-ink-500">Overrides the sound chosen per notification</span>
        </span>
        {!!one && (
          <select className="input ml-auto w-auto py-1.5" value={one} onChange={(e) => set("notifySound", e.target.value)}>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </label>

      <section className="rounded-2xl border border-ink-400/15 bg-white p-4">
        <h3 className="mb-1 flex items-center gap-2 font-bold">
          <Volume2 className="h-4 w-4 text-hive-700" /> Custom sounds
        </h3>
        <p className="mb-3 text-xs text-ink-500">
          Upload this company’s own alert sounds (.mp3, .wav, .m4a, .aac, .ogg, .oga, .opus, .webm, .flac · up to 2.0 MB). Each file is kept in S3 under <span className="mono">{(form.code || "CODE").toUpperCase()}/branding/sounds/&lt;format&gt;/</span>. MP3 or WAV play on every device, including iPhone.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-secondary inline-flex cursor-pointer items-center gap-2">
            <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload sound"}
            <input type="file" accept="audio/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {sounds.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-2 rounded-xl border border-ink-400/15 px-3 py-1.5 text-sm">
              <Volume2 className="h-3.5 w-3.5 text-ink-400" /> {s.name}
              <span className="text-[11px] text-ink-400">{s.format}</span>
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                className="text-ink-400 hover:text-red-600"
                onClick={async () => {
                  const r = await api(`/sa/companies/${id}/sound?key=${encodeURIComponent(s.key)}`, { method: "DELETE" }).catch((e: any) => toast("err", e.message));
                  if (r) set("branding", { ...form.branding, sounds: r.sounds });
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-ink-400/15">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="th">Notification</th>
              {(["mobile", "desktop"] as const).map((dev) => (
                <th key={dev} className="th text-center">
                  <span className="capitalize">{dev}</span>
                  <span className="mt-0.5 block text-[11px] font-semibold">
                    <button type="button" className="text-hive-700 hover:underline" onClick={() => allCol(dev, true)}>
                      All on
                    </button>{" "}
                    <button type="button" className="text-ink-400 hover:underline" onClick={() => allCol(dev, false)}>
                      All off
                    </button>
                  </span>
                </th>
              ))}
              <th className="th">Sound</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr className="bg-ink-400/[0.04]">
                  <td className="td eyebrow text-ink-500" colSpan={4}>
                    {g}
                  </td>
                </tr>
                {NOTIFY_KINDS.filter((n) => n.group === g).map((n) => {
                  const v = notifyOf(n, notify[n.key]);
                  return (
                    <tr key={n.key} className="hover:bg-hive-50/40">
                      <td className="td">
                        <p className="font-semibold">{n.label}</p>
                        <p className="max-w-[420px] text-xs text-ink-500">{n.description}</p>
                      </td>
                      {(["mobile", "desktop"] as const).map((dev) => (
                        <td key={dev} className="td text-center">
                          <label className="inline-flex cursor-pointer items-center">
                            <input type="checkbox" className="peer sr-only" checked={v[dev]} onChange={(e) => setRow(n.key, { [dev]: e.target.checked })} aria-label={`${n.label} on ${dev}`} />
                            <span className="relative h-6 w-11 rounded-full bg-ink-400/30 transition peer-checked:bg-hive-700 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
                          </label>
                        </td>
                      ))}
                      <td className="td">
                        <select className="input w-[200px] py-1.5" disabled={!!one} value={one || v.sound} onChange={(e) => setRow(n.key, { sound: e.target.value })}>
                          {choices.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

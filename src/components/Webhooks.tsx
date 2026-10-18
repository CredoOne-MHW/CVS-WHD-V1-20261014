"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Send, Tag, Save } from "lucide-react";
import { api } from "@/lib/api";
import { Btn, Field, Modal, Empty, Badge, useToast, Confirm, Spinner } from "./ui";
import { usePerm } from "./Shell";
import { buildPayloads } from "@shared/templating";
import { DEFAULT_PAYLOAD_TEMPLATE } from "@shared/constants";

export interface Hook {
  _id?: string;
  name: string;
  event: string;
  description?: string;
  url: string;
  method: string;
  active: boolean;
  headers: string;
  payloadTemplate: string;
  templateName?: string;
  singleLine: boolean;
  lineSeparator?: string;
  maxChars: number;
  extraNumbers?: string[];
  schedule?: { freq: "off" | "daily" | "weekly"; hour: number; weekday: number; days: number };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;

/** "AI insights" webhooks: when the digest goes out automatically (IST). */
export function InsightsSchedule({ value, onChange, disabled }: { value?: Hook["schedule"]; onChange: (v: NonNullable<Hook["schedule"]>) => void; disabled?: boolean }) {
  const v = value || { freq: "daily", hour: 9, weekday: 1, days: 1 };
  const set = (p: Partial<typeof v>) => onChange({ ...v, ...p } as any);
  return (
    <div className="rounded-2xl border border-hive-200 bg-hive-50/60 p-4">
      <p className="text-sm font-semibold text-ink-900">Send AI insights automatically</p>
      <p className="mb-3 text-xs text-ink-500">Health score, alerts, what goes well and AI recommendations from live data. Also available any time from Dashboard › Share on WhatsApp.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <select className="input" value={v.freq} disabled={disabled} onChange={(e) => set({ freq: e.target.value as any, days: e.target.value === "weekly" ? 7 : v.days })} aria-label="Frequency">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="off">Off (manual only)</option>
        </select>
        {v.freq === "weekly" && (
          <select className="input" value={v.weekday} disabled={disabled} onChange={(e) => set({ weekday: Number(e.target.value) })} aria-label="Day">
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        )}
        {v.freq !== "off" && (
          <select className="input" value={v.hour} disabled={disabled} onChange={(e) => set({ hour: Number(e.target.value) })} aria-label="Time (IST)">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)} IST
              </option>
            ))}
          </select>
        )}
        <select className="input" value={v.days} disabled={disabled} onChange={(e) => set({ days: Number(e.target.value) })} aria-label="Period covered">
          <option value={1}>Covers last 1 day</option>
          <option value={7}>Covers last 7 days</option>
          <option value={30}>Covers last 30 days</option>
        </select>
      </div>
    </div>
  );
}

/** Additional WhatsApp numbers that receive a copy of every message this webhook sends. */
export function ExtraNumbers({ value, onChange, disabled }: { value?: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const list = value || [];
  const clean = draft.replace(/\D/g, "").slice(-10);
  const valid = /^[6-9]\d{9}$/.test(clean);
  const add = () => {
    if (!valid || list.includes(clean) || list.length >= 10) return;
    onChange([...list, clean]);
    setDraft("");
  };
  return (
    <div>
      {list.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {list.map((n) => (
            <span key={n} className="inline-flex items-center gap-1.5 rounded-full border border-hive-200 bg-hive-50 py-1 pl-3 pr-1.5 font-mono text-[13px] text-hive-800">
              {n}
              {!disabled && (
                <button type="button" aria-label={`Remove ${n}`} className="grid h-5 w-5 place-items-center rounded-full text-ink-400 hover:bg-white hover:text-red-600" onClick={() => onChange(list.filter((x) => x !== n))}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && list.length < 10 && (
        <div className="flex gap-2">
          <input
            className="input font-mono"
            inputMode="numeric"
            placeholder="10-digit WhatsApp number, e.g. 9876543210"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d+ ]/g, "").slice(0, 14))}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn-secondary shrink-0" disabled={!valid || list.includes(clean)} onClick={add}>
            + Add
          </button>
        </div>
      )}
      {draft && !valid && <p className="mt-1 text-xs text-amber-700">Enter a valid 10-digit mobile number.</p>}
    </div>
  );
}

export interface EventOpt {
  _id?: string;
  key: string;
  label: string;
  system: boolean;
  group?: string;
  to?: string;
  description?: string;
  params?: string[];
  manual?: boolean;
}

/** events grouped for the dropdown, in registry order */
const byGroup = (events: EventOpt[]) => {
  const m = new Map<string, EventOpt[]>();
  for (const e of events) m.set(e.group || "Other", [...(m.get(e.group || "Other") || []), e]);
  return [...m.entries()];
};

const BLANK: Hook = {
  name: "",
  event: "",
  url: "",
  method: "POST",
  active: true,
  headers: '{\n  "Authorization": "Bearer YOUR_TOKEN"\n}',
  payloadTemplate: '{\n  "to": "{{phone}}",\n  "message": "{{message}}"\n}',
  singleLine: true,
  lineSeparator: " | ",
  maxChars: 800,
};

const SAMPLES: Record<string, string> = {
  company_reminder: "Dear Partner,\nYour Trial plan ends in 3 days.\nUpgrade to keep capturing leads without interruption.",
  lead_reminder: "Hi {{name}}, this is a reminder for your full-body health check.\nHome sample collection is available 7am–11am.\nReply YES to confirm a slot.",
  lead_created: "Hi {{name}}, thanks for contacting us! Our care team will call you shortly.",
  followup_digest: "Good morning! Lead digest:\n• 4 new lead(s) not yet contacted\n• 6 follow-up(s) due today\n\n1. Riya Sen (9876543210) – Interested\n2. Amit Das (9830012345) – Price / Package Shared",
  delete_otp: "482913 is your OTP to delete lead \"Riya Sen\". Valid for 5 minutes. Do not share.",
};
const sampleFor = (ev: string) => SAMPLES[ev] || "Hello {{name}},\nThis is a sample message.\nThank you.";

/* ───────── Add / Edit Webhook (Picture 2) ───────── */
export function WebhookModal({ open, onClose, base, events, initial, onSaved, onNewEvent }: { open: boolean; onClose: () => void; base: string; events: EventOpt[]; initial?: Hook | null; onSaved: () => void; onNewEvent?: () => void }) {
  const [f, setF] = useState<Hook>(BLANK);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) setF(initial ? { ...BLANK, ...initial } : { ...BLANK, event: events[0]?.key || "" });
  }, [open, initial, events]);
  const set = (k: keyof Hook, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      const body = { ...f, maxChars: Number(f.maxChars) || 800 };
      if (f._id) await api(`${base}/webhooks/${f._id}`, { method: "PUT", body });
      else await api(`${base}/webhooks`, { body });
      toast("ok", "Webhook saved");
      onSaved();
      onClose();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={f._id ? "Edit Webhook" : "Add Webhook"}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn loading={busy} onClick={save} disabled={!f.name || !f.url || !f.event}>
            Save
          </Btn>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" required>
          <input className="input" placeholder="e.g. CredoOne WA API" value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Event" hint={onNewEvent ? <button type="button" className="font-semibold text-hive-700 underline" onClick={onNewEvent}>+ New event type</button> : undefined}>
          <select
            className="input"
            value={f.event}
            onChange={(e) => {
              set("event", e.target.value);
              if (e.target.value === "ai_insights" && !f.schedule) set("schedule", { freq: "daily", hour: 9, weekday: 1, days: 1 });
            }}
          >
            {f.event && !events.some((ev) => ev.key === f.event) && <option value={f.event}>{f.event} — no longer sent by the app</option>}
            {byGroup(events).map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.map((ev) => (
                  <option key={ev.key} value={ev.key}>
                    {ev.label}
                    {ev.to ? ` → ${ev.to}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {(() => {
            const ev = events.find((x) => x.key === f.event);
            if (!ev) return f.event ? <p className="mt-1.5 text-xs text-amber-700">This event isn’t sent by the current version of the app — pick another one.</p> : null;
            return (
              <p className="mt-1.5 text-xs text-ink-500">
                {ev.description}
                {ev.to ? <> · Sent to: <b className="text-ink-700">{ev.to}</b></> : null}
                {ev.params?.length ? <> · Params: <span className="mono">{ev.params.map((p) => `{{params.${p}}}`).join(" ")}</span></> : null}
              </p>
            );
          })()}
        </Field>
        <Field label="Endpoint URL" required className="sm:col-span-2">
          <input className="input" placeholder="https://wapp-api.credoone.org/…" value={f.url} onChange={(e) => set("url", e.target.value)} />
        </Field>
        {f.event === "ai_insights" && (
          <div className="sm:col-span-2">
            <InsightsSchedule value={f.schedule} onChange={(v) => set("schedule", v)} />
          </div>
        )}
        <Field label="Additional numbers (optional)" className="sm:col-span-2" hint="Each gets a copy of every message this webhook sends — e.g. the owner or a manager. Up to 10. Not used for bulk Post or test sends.">
          <ExtraNumbers value={f.extraNumbers} onChange={(v) => set("extraNumbers", v)} />
        </Field>
        <Field label="Method">
          <select className="input" value={f.method} onChange={(e) => set("method", e.target.value)}>
            {["POST", "PUT", "PATCH", "GET"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Active">
          <select className="input" value={f.active ? "yes" : "no"} onChange={(e) => set("active", e.target.value === "yes")}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <Field label="Headers (JSON)" className="sm:col-span-2">
          <textarea className="input mono min-h-[110px]" value={f.headers} onChange={(e) => set("headers", e.target.value)} spellCheck={false} />
        </Field>
        <Field label="Payload template (JSON)" className="sm:col-span-2" hint="Placeholders: {{phone}} {{message}} {{name}} {{company}} {{event}} {{template}} {{to}} {{message_raw}} {{params}}">
          <textarea className="input mono min-h-[150px]" value={f.payloadTemplate} onChange={(e) => set("payloadTemplate", e.target.value)} spellCheck={false} />
        </Field>
      </div>
    </Modal>
  );
}

/* ───────── Webhook card (Picture 3) ───────── */
export function WebhookCard({ hook, base, eventLabel, testPhone, onChanged }: { hook: Hook; base: string; eventLabel: string; testPhone: string; onChanged: () => void }) {
  const [f, setF] = useState<Hook>(hook);
  const [sample, setSample] = useState(sampleFor(hook.event));
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [del, setDel] = useState(false);
  const perm = usePerm("wa_webhooks");
  const toast = useToast();
  useEffect(() => {
    setF(hook);
  }, [hook]);
  const dirty = JSON.stringify(f) !== JSON.stringify(hook);
  const set = (k: keyof Hook, v: any) => setF((p) => ({ ...p, [k]: v }));

  const preview = useMemo(() => {
    try {
      const sep = f.lineSeparator === "" ? " | " : f.lineSeparator;
      const p = buildPayloads({ ...f, lineSeparator: sep, maxChars: Number(f.maxChars) || 800 }, { phone: testPhone || "9876543210", name: "Riya Sen", company: "Wellness Hive", message: sample.replace(/\{\{\s*name\s*\}\}/g, "Riya Sen"), params: { status: "Interested" } });
      return { ok: true as const, parts: p, chars: sample.length };
    } catch (e: any) {
      return { ok: false as const, error: e.message };
    }
  }, [f, sample, testPhone]);

  async function save() {
    setBusy("save");
    try {
      await api(`${base}/webhooks/${hook._id}`, { method: "PUT", body: { ...f, maxChars: Number(f.maxChars) || 800 } });
      toast("ok", "Saved");
      onChanged();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }
  async function test() {
    if (!/^\d{10}$/.test(testPhone)) return toast("err", "Enter a 10-digit test phone number at the top of the page");
    setBusy("test");
    try {
      const r = await api<{ results: { ok: boolean; status: number; part?: string }[] }>(`${base}/webhooks/${hook._id}/test`, { body: { phone: testPhone, message: sample } });
      const ok = r.results.every((x) => x.ok);
      toast(ok ? "ok" : "err", ok ? `Sent (${r.results.length} message${r.results.length > 1 ? "s" : ""})` : `Failed – HTTP ${r.results.find((x) => !x.ok)?.status}. See WhatsApp Logs.`);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card flex flex-col border-t-4 border-t-[#4a6f8a] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-ink-900">{f.name}</h3>
          <p className="mt-0.5 text-[13px] text-ink-500">
            {eventLabel} · event: <span className="mono">{f.event}</span>
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-semibold text-hive-700">
          <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={f.active} disabled={!perm.update} onChange={(e) => set("active", e.target.checked)} />
          Active
        </label>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="Webhook URL">
          <input className="input" value={f.url} disabled={!perm.update} onChange={(e) => set("url", e.target.value)} />
        </Field>
        <Field label="Template name (optional)">
          <input className="input" value={f.templateName || ""} placeholder={f.event} disabled={!perm.update} onChange={(e) => set("templateName", e.target.value)} />
        </Field>
        {f.event === "ai_insights" && <InsightsSchedule value={f.schedule} disabled={!perm.update} onChange={(v) => set("schedule", v)} />}
        <Field label="Additional numbers" hint="Also receive a copy of every message (not bulk Post / tests). Save to apply.">
          <ExtraNumbers value={f.extraNumbers} disabled={!perm.update} onChange={(v) => set("extraNumbers", v)} />
        </Field>
        <label className="flex gap-3 text-sm text-ink-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-hive-700" checked={f.singleLine} disabled={!perm.update} onChange={(e) => set("singleLine", e.target.checked)} />
          <span>
            Send <code className="mono">{"{{message}}"}</code> as a single line – required for WhatsApp template variables (no line breaks / tabs). Raw multi-line text stays available as <code className="mono">{"{{message_raw}}"}</code>
          </span>
        </label>
        <Field label='Line separator (blank = " | ")'>
          <input className="input" value={f.lineSeparator ?? ""} disabled={!perm.update || !f.singleLine} onChange={(e) => set("lineSeparator", e.target.value)} />
        </Field>
        <Field label="Max characters per message (blank = 800)" hint="Meta allows 1024 for variables + template text. Longer messages are split into batches that end at a block / sentence, sent in order and marked (Part 1/3).">
          <input className="input" type="number" min={100} max={4096} value={f.maxChars} disabled={!perm.update} onChange={(e) => set("maxChars", e.target.value as any)} />
        </Field>
        <Field label="Payload (JSON) – editable">
          <textarea className="input mono min-h-[170px]" spellCheck={false} value={f.payloadTemplate} disabled={!perm.update} onChange={(e) => set("payloadTemplate", e.target.value)} />
        </Field>
        <p className="text-xs leading-6 text-ink-500">
          Placeholders: {"{{event}} {{template}} {{to}} {{phone}} {{name}} {{company}} {{message}} {{message_raw}} {{params}} {{params.status}}"}{" "}
          <button className="ml-1 rounded-lg border border-ink-400/30 px-2 py-0.5 font-semibold text-ink-700 hover:bg-hive-50" onClick={() => set("payloadTemplate", DEFAULT_PAYLOAD_TEMPLATE)} disabled={!perm.update}>
            Reset to default
          </button>
        </p>

        <details className="group">
          <summary className="cursor-pointer select-none font-semibold text-[#4a6f8a]">Sample WhatsApp message</summary>
          <textarea className="input mt-2 min-h-[110px]" value={sample} onChange={(e) => setSample(e.target.value)} />
          <p className="mt-1 text-xs text-ink-400">Used for the preview below and by “Send test”. {"{{name}}"} is filled with the recipient’s name.</p>
        </details>
        <details>
          <summary className="cursor-pointer select-none font-semibold text-[#4a6f8a]">
            Preview of the payload {preview.ok ? `(sample: ${preview.chars} chars → ${preview.parts.length} message${preview.parts.length > 1 ? "s" : ""})` : ""}
          </summary>
          {preview.ok ? (
            <div className="mt-2 space-y-2">
              {preview.parts.map((p, i) => (
                <pre key={i} className="mono max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-ink-900 p-3 text-hive-100">
                  {p.part ? `// Part ${p.part}\n` : ""}
                  {JSON.stringify(p.body, null, 2)}
                </pre>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{preview.error}</p>
          )}
        </details>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink-400/10 pt-4">
        <Btn variant="secondary" onClick={test} loading={busy === "test"}>
          <Send className="h-4 w-4" /> Send test
        </Btn>
        {perm.update && (
          <Btn onClick={save} loading={busy === "save"} disabled={!dirty}>
            <Save className="h-4 w-4" /> Save
          </Btn>
        )}
        {perm.delete && (
          <button className="btn-ghost ml-auto text-red-600" onClick={() => setDel(true)} aria-label="Delete webhook">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <Confirm
        open={del}
        danger
        title="Delete webhook?"
        body={`“${f.name}” will stop sending ${f.event} messages.`}
        confirmLabel="Delete"
        onClose={() => setDel(false)}
        onConfirm={async () => {
          await api(`${base}/webhooks/${hook._id}`, { method: "DELETE" });
          onChanged();
        }}
      />
    </div>
  );
}

/* ───────── Webhook page body (cards grouped by event) ───────── */
export function WebhookBoard({ base, createAlign = "right", allowEventTypes = false }: { base: "/sa" | "/co"; createAlign?: "left" | "right"; allowEventTypes?: boolean }) {
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [events, setEvents] = useState<EventOpt[]>([]);
  const [modal, setModal] = useState(false);
  const [evModal, setEvModal] = useState(false);
  const [newEv, setNewEv] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const perm = usePerm("wa_webhooks");
  const toast = useToast();

  const load = () => {
    api<{ items: Hook[] }>(`${base}/webhooks`).then((r) => setHooks(r.items));
    api<EventOpt[]>(`${base}/webhooks/events`).then(setEvents);
  };
  useEffect(() => {
    load();
    try {
      setTestPhone(localStorage.getItem("lms_test_phone") || "");
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (k: string) => events.find((e) => e.key === k)?.label || (events.length ? `${k} — no longer sent by the app` : k);
  const groups = useMemo(() => {
    const m = new Map<string, Hook[]>();
    for (const h of hooks || []) m.set(h.event, [...(m.get(h.event) || []), h]);
    return [...m.entries()];
  }, [hooks]);

  const createBtn = perm.create && (
    <Btn onClick={() => setModal(true)}>
      <Plus className="h-4 w-4" /> Create
    </Btn>
  );

  return (
    <div>
      <div className={`mb-6 flex flex-wrap items-center gap-3 ${createAlign === "right" ? "flex-row-reverse justify-between" : "justify-between"}`}>
        <div className="flex gap-2">
          {createBtn}
          {allowEventTypes && perm.create && (
            <Btn variant="secondary" onClick={() => setEvModal(true)}>
              <Tag className="h-4 w-4" /> Event types
            </Btn>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            className="input w-56"
            inputMode="numeric"
            maxLength={10}
            placeholder="Test phone number e.g. 9876543210"
            value={testPhone}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 10);
              setTestPhone(v);
              try {
                localStorage.setItem("lms_test_phone", v);
              } catch {}
            }}
          />
          <span className="hidden text-sm text-ink-500 sm:inline">used by the “Send test” buttons</span>
        </div>
      </div>

      {!hooks ? (
        <div className="flex justify-center py-20 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      ) : !hooks.length ? (
        <div className="card">
          <Empty title="No webhooks yet" hint="Create a webhook for each event that should send WhatsApp messages." action={createBtn} />
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([ev, list]) => (
            <section key={ev}>
              <h2 className="mb-3 text-lg font-bold text-[#22305f]">{label(ev)}</h2>
              <div className="grid gap-5 xl:grid-cols-2">
                {list.map((h) => (
                  <WebhookCard key={h._id} hook={h} base={base} eventLabel={`${list.length > 1 ? "One of " + list.length + " hooks" : "Sent to recipient"}`} testPhone={testPhone} onChanged={load} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <WebhookModal open={modal} onClose={() => setModal(false)} base={base} events={events} onSaved={load} onNewEvent={allowEventTypes ? () => setEvModal(true) : undefined} />

      <Modal open={evModal} onClose={() => setEvModal(false)} title="Event types" size="md">
        <p className="mb-4 text-sm text-ink-500">System events fire automatically. Custom events are for your own webhooks — use them from Post, lead reminders or the API.</p>
        <ul className="mb-5 divide-y divide-ink-400/10 rounded-xl border border-ink-400/15">
          {events.map((e) => (
            <li key={e.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>
                <span className="font-semibold">{e.label}</span> <span className="mono text-ink-400">{e.key}</span>
              </span>
              {e.system ? (
                <Badge>System</Badge>
              ) : (
                <button
                  className="btn-ghost text-red-600"
                  aria-label={`Delete ${e.label}`}
                  onClick={async () => {
                    await api(`${base}/webhooks/events/${e._id}`, { method: "DELETE" });
                    load();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input className="input" placeholder="e.g. Appointment confirmation" value={newEv} onChange={(e) => setNewEv(e.target.value)} />
          <Btn
            disabled={newEv.trim().length < 2}
            onClick={async () => {
              try {
                await api(`${base}/webhooks/events`, { body: { label: newEv.trim() } });
                setNewEv("");
                load();
                toast("ok", "Event type added");
              } catch (e: any) {
                toast("err", e.message);
              }
            }}
          >
            Add
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

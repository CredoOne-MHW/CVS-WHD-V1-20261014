"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Upload, Download, Search, BellRing, Pencil, Trash2, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { api, qs, fmtDate } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Empty, Pager, Spinner, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";
import { LEAD_STATUSES, LOST_REASONS, LOST_STATUS } from "@shared/constants";

const STATUS_COLOR: Record<string, any> = {
  New: "blue",
  "Contact Attempted": "gray",
  Interested: "green",
  "Not Interested": "gray",
  "Requirement Identified": "violet",
  "Price / Package Shared": "honey",
  "Appointment Booked": "violet",
  "Converted / Service Initiated": "green",
  "Follow-ups needed": "honey",
  "Lost / Not Converted": "red",
};

const BLANK = { name: "", whatsapp: "", phone: "", email: "", address: "", comments: "", source: "manual", campaign: "", status: "New", consentWhatsapp: true };

function LeadsInner() {
  const sp = useSearchParams();
  const [f, setF] = useState({ q: "", status: sp?.get("status") || "", source: "", from: "", to: "", page: 1 });
  const [data, setData] = useState<any>(null);
  const [meta, setMeta] = useState<any>({ sources: [] });
  const [add, setAdd] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [lost, setLost] = useState<{ lead: any; reason: string; other: string } | null>(null);
  const [rem, setRem] = useState<{ lead: any; message: string; webhookId: string; next: string } | null>(null);
  const [hooks, setHooks] = useState<any[]>([]);
  const [otp, setOtp] = useState<{ lead: any; sentTo?: string; code: string } | null>(null);
  const [imp, setImp] = useState(false);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("leads");
  const toast = useToast();

  const load = useCallback(() => api(`/co/leads${qs(f)}`).then(setData), [f]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api("/co/leads/meta").then(setMeta);
    api("/co/webhooks").then((r) => setHooks(r.items.filter((h: any) => h.active))).catch(() => {});
  }, []);

  async function changeStatus(lead: any, status: string) {
    if (status === LOST_STATUS) return setLost({ lead, reason: "", other: "" });
    try {
      await api(`/co/leads/${lead._id}`, { method: "PUT", body: { status } });
      toast("ok", `Status → ${status}`);
      load();
    } catch (e: any) {
      toast("err", e.message);
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  const counts = data?.counts || {};
  const totalAll = Object.values(counts).reduce((a: number, b: any) => a + b, 0) as number;

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Every enquiry from every channel, de-duplicated by phone and email"
        actions={
          <>
            <a className="btn-secondary" href={`/api/co/leads/export.csv${qs({ ...f, page: undefined })}`}>
              <Download className="h-4 w-4" /> Export
            </a>
            {perm.create && (
              <Btn variant="secondary" onClick={() => setImp(true)}>
                <Upload className="h-4 w-4" /> Import
              </Btn>
            )}
            {perm.create && (
              <Btn onClick={() => setAdd({ ...BLANK })}>
                <Plus className="h-4 w-4" /> Add lead
              </Btn>
            )}
          </>
        }
      />

      {/* status chips */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setF({ ...f, status: "", page: 1 })} className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${!f.status ? "border-hive-700 bg-hive-700 text-white" : "border-ink-400/25 bg-white text-ink-700"}`}>
          All <span className="opacity-70">{totalAll}</span>
        </button>
        {LEAD_STATUSES.map((s) => (
          <button key={s} onClick={() => setF({ ...f, status: s, page: 1 })} className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${f.status === s ? "border-hive-700 bg-hive-700 text-white" : "border-ink-400/25 bg-white text-ink-700 hover:bg-hive-50"}`}>
            {s} <span className="opacity-70">{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input w-72 pl-9" placeholder="Search name, phone, email, comments" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
          </div>
          <select className="input w-auto" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value, page: 1 })} aria-label="Source">
            <option value="">All sources</option>
            {meta.sources.map((s: string) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input type="date" className="input w-auto" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} aria-label="From" />
          <input type="date" className="input w-auto" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} aria-label="To" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px]">
            <thead>
              <tr>
                {["Name", "WhatsApp No", "Phone No", "Email ID", "Address", "Comments", "Source", "Status", "Action"].map((h) => (
                  <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((l: any) => (
                <tr key={l._id} className="hover:bg-hive-50/40">
                  <td className="td">
                    <button className="text-left font-semibold text-ink-900 hover:text-hive-700" onClick={() => api(`/co/leads/${l._id}`).then((x) => setEdit({ ...x, remark: "" }))}>
                      {l.name || "NA"}
                    </button>
                    <p className="text-xs text-ink-400">{fmtDate(l.createdAt)}</p>
                  </td>
                  <td className="td mono">{l.whatsapp || "NA"}</td>
                  <td className="td mono">{l.phone || "NA"}</td>
                  <td className="td max-w-[180px] truncate">{l.email || "NA"}</td>
                  <td className="td max-w-[160px] truncate" title={l.address}>
                    {l.address || "NA"}
                  </td>
                  <td className="td max-w-[220px]">
                    <p className="line-clamp-2 text-ink-700" title={l.comments}>
                      {l.comments || "NA"}
                    </p>
                  </td>
                  <td className="td">
                    <Badge>{l.source}</Badge>
                    {l.campaign && <p className="mt-1 max-w-[140px] truncate text-xs text-ink-400">{l.campaign}</p>}
                  </td>
                  <td className="td">
                    <select
                      className={`rounded-lg border-0 py-1 pl-2 pr-7 text-xs font-semibold ring-1 ring-inset ring-ink-400/20 focus:ring-2 focus:ring-hive-500 ${l.status === LOST_STATUS ? "bg-red-50 text-red-700" : "bg-hive-50 text-hive-800"}`}
                      value={l.status}
                      disabled={!perm.update}
                      onChange={(e) => changeStatus(l, e.target.value)}
                      aria-label="Status"
                    >
                      {LEAD_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    {l.status === LOST_STATUS && l.lostReason && <p className="mt-1 max-w-[180px] truncate text-xs text-red-600">{l.lostReason === "Other" ? l.lostReasonOther : l.lostReason}</p>}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      {perm.update && (
                        <button className="btn-ghost" title="Reminder" aria-label="Reminder" onClick={() => setRem({ lead: l, message: `Hi {{name}}, `, webhookId: "", next: "" })}>
                          <BellRing className="h-4 w-4" />
                        </button>
                      )}
                      {perm.update && (
                        <button className="btn-ghost" title="Edit" aria-label="Edit" onClick={() => api(`/co/leads/${l._id}`).then((x) => setEdit({ ...x, remark: "" }))}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {perm.delete && (
                        <button className="btn-ghost text-red-600" title="Delete (WhatsApp OTP)" aria-label="Delete" onClick={() => setOtp({ lead: l, code: "" })}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && (
            <div className="flex justify-center py-16 text-hive-700">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {data && !data.items.length && <Empty title="No leads match" hint="Connect a channel under Integration or add a lead manually." />}
        </div>
        {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </div>

      {/* Add lead */}
      <Modal
        open={!!add}
        onClose={() => setAdd(null)}
        title="Add lead"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setAdd(null)}>
              Cancel
            </Btn>
            <Btn
              loading={busy}
              onClick={() =>
                run(async () => {
                  const r = await api("/co/leads", { body: add });
                  toast("ok", r.created ? "Lead added" : "Existing lead found — details merged");
                  setAdd(null);
                  load();
                })
              }
            >
              Save
            </Btn>
          </>
        }
      >
        {add && <LeadFields v={add} set={setAdd} />}
      </Modal>

      {/* Edit lead */}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.name || "Lead"}
        size="xl"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Btn>
            {perm.update && (
              <Btn
                loading={busy}
                onClick={() =>
                  run(async () => {
                    if (edit.status === LOST_STATUS && !edit.lostReason) throw new Error("Select a lost reason");
                    const { _id, name, whatsapp, phone, email, address, comments, source, campaign, status, remark, lostReason, lostReasonOther, nextFollowUpAt } = edit;
                    await api(`/co/leads/${_id}`, { method: "PUT", body: { name, whatsapp, phone, email, address, comments, source, campaign, status, remark: remark || undefined, lostReason: status === LOST_STATUS ? lostReason : undefined, lostReasonOther, nextFollowUpAt: nextFollowUpAt || null } });
                    toast("ok", "Lead updated");
                    setEdit(null);
                    load();
                  })
                }
              >
                Save
              </Btn>
            )}
          </>
        }
      >
        {edit && (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-5">
              <LeadFields v={edit} set={setEdit} />
              {edit.status === LOST_STATUS && <LostFields reason={edit.lostReason || ""} other={edit.lostReasonOther || ""} onChange={(reason, other) => setEdit({ ...edit, lostReason: reason, lostReasonOther: other })} />}
              <Field label="Next follow-up">
                <input type="datetime-local" className="input" value={edit.nextFollowUpAt ? new Date(new Date(edit.nextFollowUpAt).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16) : ""} onChange={(e) => setEdit({ ...edit, nextFollowUpAt: e.target.value ? new Date(e.target.value + ":00+05:30").toISOString() : "" })} />
              </Field>
              <Field label="Remarks by Company Admin" hint="Saved to the lead's timeline">
                <textarea className="input min-h-[90px]" value={edit.remark} onChange={(e) => setEdit({ ...edit, remark: e.target.value })} placeholder="e.g. Called at 11am, wants home collection on Saturday" />
              </Field>
            </div>
            <aside className="space-y-5">
              <div className="rounded-2xl bg-hive-50/70 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Score</p>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 rounded-full bg-white">
                    <div className="h-2 rounded-full bg-hive-600" style={{ width: `${edit.score}%` }} />
                  </div>
                  <span className="font-bold tabular-nums">{edit.score}</span>
                </div>
                {edit.consent?.whatsapp != null && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-700">
                    <ShieldCheck className="h-3.5 w-3.5 text-hive-600" /> WhatsApp consent: {edit.consent.whatsapp ? "Yes" : "No"} · {fmtDate(edit.consent.capturedAt)}
                  </p>
                )}
              </div>
              {(edit.profileUrl || edit.source === "web_prospect") && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  <p className="mb-1.5 font-bold uppercase tracking-wider">Public source</p>
                  {edit.profileUrl && (
                    <a href={edit.profileUrl} target="_blank" rel="noreferrer noopener" className="block truncate font-semibold text-hive-800 underline">
                      Profile / post: {edit.profileUrl.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                  {edit.referral && /^https?:/.test(edit.referral) && (
                    <a href={edit.referral} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-hive-800 underline">
                      Found on: {edit.referral.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                  {edit.customFields?.organisation && <p className="mt-1">Organisation: {edit.customFields.organisation} · Role: {edit.customFields.role || "NA"}</p>}
                  <p className="mt-2">Collected from a public post — no opt-in. Reply where they posted, and get their consent before sending WhatsApp messages.</p>
                </div>
              )}
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Attribution history</p>
                <ol className="space-y-2">
                  {edit.attribution?.map((a: any, i: number) => (
                    <li key={i} className="rounded-xl border border-ink-400/15 p-3 text-xs">
                      <p className="font-semibold text-ink-900">
                        {i === 0 ? "First touch · " : ""}
                        {a.source}
                      </p>
                      <p className="text-ink-500">{[a.campaign, a.medium, a.referral].filter(Boolean).join(" · ") || "—"}</p>
                      <p className="text-ink-400">{fmtDate(a.at)}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Timeline</p>
                <ol className="max-h-72 space-y-3 overflow-y-auto border-l-2 border-hive-100 pl-4">
                  {[...(edit.remarks || [])].reverse().map((r: any, i: number) => (
                    <li key={i} className="text-xs">
                      <p className="text-ink-400">
                        {fmtDate(r.at)} · {r.by}
                      </p>
                      {r.statusTo && (
                        <p className="font-semibold text-hive-800">
                          {r.statusFrom ? `${r.statusFrom} → ` : ""}
                          {r.statusTo}
                        </p>
                      )}
                      {r.text && <p className="text-ink-700">{r.text}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            </aside>
          </div>
        )}
      </Modal>

      {/* Mandatory lost reason */}
      <Modal
        open={!!lost}
        onClose={() => setLost(null)}
        title="Why was this lead lost?"
        size="sm"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setLost(null)}>
              Cancel
            </Btn>
            <Btn
              loading={busy}
              disabled={!lost?.reason || (lost.reason === "Other" && !lost.other.trim())}
              onClick={() =>
                run(async () => {
                  await api(`/co/leads/${lost!.lead._id}`, { method: "PUT", body: { status: LOST_STATUS, lostReason: lost!.reason, lostReasonOther: lost!.other || undefined } });
                  toast("ok", "Marked as lost");
                  setLost(null);
                  load();
                })
              }
            >
              Mark as lost
            </Btn>
          </>
        }
      >
        {lost && <LostFields reason={lost.reason} other={lost.other} onChange={(reason, other) => setLost({ ...lost, reason, other })} />}
      </Modal>

      {/* Reminder */}
      <Modal
        open={!!rem}
        onClose={() => setRem(null)}
        title={`WhatsApp reminder · ${rem?.lead.name || rem?.lead.whatsapp || ""}`}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setRem(null)}>
              Cancel
            </Btn>
            <Btn
              loading={busy}
              disabled={!rem?.message.trim()}
              onClick={() =>
                run(async () => {
                  const r = await api(`/co/leads/${rem!.lead._id}/reminder`, { body: { message: rem!.message, webhookId: rem!.webhookId || undefined, nextFollowUpAt: rem!.next ? new Date(rem!.next + ":00+05:30").toISOString() : undefined } });
                  const ok = (r.results || []).some((x: any) => x.ok);
                  toast(ok ? "ok" : "err", ok ? "Reminder sent" : r.reason || "Send failed — check WhatsApp Logs");
                  if (ok) setRem(null);
                })
              }
            >
              Send
            </Btn>
          </>
        }
      >
        {rem && (
          <div className="space-y-4">
            <Field label="Webhook" hint="Default: every active webhook on the “Lead reminder” event">
              <select className="input" value={rem.webhookId} onChange={(e) => setRem({ ...rem, webhookId: e.target.value })}>
                <option value="">Lead reminder event (default)</option>
                {hooks.map((h) => (
                  <option key={h._id} value={h._id}>
                    {h.name} · {h.event}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Message" hint="{{name}} is replaced with the lead's name">
              <textarea className="input min-h-[120px]" value={rem.message} onChange={(e) => setRem({ ...rem, message: e.target.value })} />
            </Field>
            <Field label="Set next follow-up (optional)">
              <input type="datetime-local" className="input" value={rem.next} onChange={(e) => setRem({ ...rem, next: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      {/* OTP delete */}
      <Modal
        open={!!otp}
        onClose={() => setOtp(null)}
        title="Delete lead"
        size="sm"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setOtp(null)}>
              Cancel
            </Btn>
            {!otp?.sentTo ? (
              <Btn
                loading={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api(`/co/leads/${otp!.lead._id}/delete-otp`, { method: "POST" });
                    setOtp({ ...otp!, sentTo: r.sentTo });
                  })
                }
              >
                Send OTP on WhatsApp
              </Btn>
            ) : (
              <Btn
                variant="danger"
                loading={busy}
                disabled={otp.code.length !== 6}
                onClick={() =>
                  run(async () => {
                    await api(`/co/leads/${otp!.lead._id}/delete-confirm`, { body: { otp: otp!.code } });
                    toast("ok", "Lead deleted");
                    setOtp(null);
                    load();
                  })
                }
              >
                Verify & delete
              </Btn>
            )}
          </>
        }
      >
        {otp && (
          <div className="space-y-4 text-sm text-ink-700">
            <p>
              Deleting <b>{otp.lead.name || otp.lead.phone}</b> needs a one-time code sent to your WhatsApp.
            </p>
            {otp.sentTo && (
              <Field label={`OTP sent to ${otp.sentTo}`} hint="Valid for 5 minutes">
                <input className="input text-center text-2xl font-bold tracking-[.5em]" inputMode="numeric" maxLength={6} autoFocus value={otp.code} onChange={(e) => setOtp({ ...otp, code: e.target.value.replace(/\D/g, "") })} />
              </Field>
            )}
          </div>
        )}
      </Modal>

      <ImportModal open={imp} onClose={() => setImp(false)} onDone={load} />
    </>
  );
}

function LeadFields({ v, set }: { v: any; set: (x: any) => void }) {
  const u = (k: string, val: any) => set({ ...v, [k]: val });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name">
        <input className="input" value={v.name || ""} onChange={(e) => u("name", e.target.value)} />
      </Field>
      <Field label="Status">
        <select className="input" value={v.status} onChange={(e) => u("status", e.target.value)}>
          {LEAD_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="WhatsApp No" hint="10 digits, no +91">
        <input className="input" inputMode="numeric" maxLength={10} placeholder={v._id ? "NA" : undefined} value={v.whatsapp || ""} onChange={(e) => u("whatsapp", e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="Phone No">
        <input className="input" inputMode="numeric" maxLength={10} placeholder={v._id ? "NA" : undefined} value={v.phone || ""} onChange={(e) => u("phone", e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="Email ID">
        <input className="input" type="email" placeholder={v._id ? "NA" : undefined} value={v.email || ""} onChange={(e) => u("email", e.target.value)} />
      </Field>
      <Field label="Source">
        <input className="input" value={v.source || ""} onChange={(e) => u("source", e.target.value)} />
      </Field>
      <Field label="Campaign">
        <input className="input" value={v.campaign || ""} onChange={(e) => u("campaign", e.target.value)} />
      </Field>
      <Field label="Address">
        <input className="input" value={v.address || ""} onChange={(e) => u("address", e.target.value)} />
      </Field>
      <Field label="Comments" className="sm:col-span-2">
        <textarea className="input min-h-[80px]" value={v.comments || ""} onChange={(e) => u("comments", e.target.value)} />
      </Field>
      {"consentWhatsapp" in v && (
        <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={!!v.consentWhatsapp} onChange={(e) => u("consentWhatsapp", e.target.checked)} />
          Lead agreed to receive WhatsApp messages
        </label>
      )}
    </div>
  );
}

function LostFields({ reason, other, onChange }: { reason: string; other: string; onChange: (reason: string, other: string) => void }) {
  return (
    <div className="space-y-4 rounded-2xl border border-red-200 bg-red-50/50 p-4">
      <Field label="Lost reasons" required>
        <select className="input" value={reason} onChange={(e) => onChange(e.target.value, e.target.value === "Other" ? other : "")}>
          <option value="">Select a reason</option>
          {LOST_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </Field>
      {reason === "Other" && (
        <Field label="Describe the reason" required>
          <textarea className="input min-h-[80px]" autoFocus value={other} onChange={(e) => onChange(reason, e.target.value)} />
        </Field>
      )}
    </div>
  );
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [campaign, setCampaign] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setFile(null);
      setRes(null);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import leads (Excel / CSV)"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Close
          </Btn>
          <Btn
            loading={busy}
            disabled={!file}
            onClick={async () => {
              setBusy(true);
              try {
                const fd = new FormData();
                fd.append("file", file!);
                if (campaign) fd.append("campaign", campaign);
                const r = await api("/co/leads/import", { form: fd });
                setRes(r);
                onDone();
              } catch (e: any) {
                toast("err", e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Upload className="h-4 w-4" /> Import
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href="/api/co/leads/template.xlsx">
            <FileSpreadsheet className="h-4 w-4" /> Sample .xlsx
          </a>
          <a className="btn-secondary" href="/api/co/leads/template.csv">
            <Download className="h-4 w-4" /> Sample .csv
          </a>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-hive-200 bg-hive-50/50 px-4 py-8 text-center hover:bg-hive-50">
          <Upload className="mb-2 h-6 w-6 text-hive-600" />
          <span className="text-sm font-semibold">{file ? file.name : "Choose .xlsx or .csv (max 5,000 rows, 4 MB)"}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <Field label="Campaign (optional)" hint="Applied to rows without a Campaign column">
          <input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </Field>
        {res && (
          <div className="rounded-2xl bg-hive-50 p-4 text-sm">
            <p className="font-semibold">
              {res.created} new · {res.merged} merged into existing · {res.failed} failed (of {res.total})
            </p>
            {res.errors.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-red-700">
                {res.errors.map((e: any) => (
                  <li key={e.row}>
                    Row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Leads() {
  return (
    <Suspense>
      <LeadsInner />
    </Suspense>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, BellRing, Search, Repeat, Zap, Paperclip, X, Download } from "lucide-react";
import { api, qs, fmtDate, inr } from "@/lib/api";
import { Btn, Modal, Field, Empty, Pager, Spinner, Confirm, Stat, useToast } from "../ui";
import { usePerm, useMe } from "../Shell";
import { Tabs } from "../Logs";
import { ServicePicker } from "../ServicePicker";
import { CLIENT_FREQUENCIES, PAYMENT_MODES, applyDiscount, clientFreqLabel, linesOf, round2, ATTACHMENT_ACCEPT, ATTACHMENT_MAX_MB } from "@shared/clients";
import { ClientSelect, PAY_STATUS } from "./common";

type View = "recurring" | "on_demand" | "history";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const istDate = (d?: string) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) : "");
const fromIst = (s: string) => (s ? new Date(s + "T00:00:00+05:30").toISOString() : undefined);

/** Client › Subscription Management: Sales Order · Invoice (Recurring | On-Demand) · Pay-In. */
export function Billing() {
  const so = usePerm("clients:sales_order"), inv = usePerm("clients:invoice"), pin = usePerm("clients:payin");
  // Each tab is its own sub-module in Role Management — show only what the role can read.
  const tabs = [so.read && { key: "details" as const, label: "Sales Order" }, inv.read && { key: "payment" as const, label: "Invoice" }, pin.read && { key: "history" as const, label: "Pay-In" }].filter(Boolean) as { key: "details" | "payment" | "history"; label: string }[];
  const [pick, setTab] = useState<"details" | "payment" | "history">("details");
  const tab = tabs.some((t) => t.key === pick) ? pick : tabs[0]?.key;
  const [sub, setSub] = useState<"recurring" | "on_demand">("recurring");
  if (!tabs.length) return <Empty title="No access" hint="Your role has no access to Sales Order, Invoice or Pay-In." />;
  return (
    <>
      <Tabs value={tab!} onChange={setTab} tabs={tabs} />
      {tab === "details" && <PlanTable />}
      {tab === "payment" && (
        <>
          <div className="mb-4 inline-flex rounded-xl border border-ink-400/15 bg-white p-1">
            {(
              [
                ["recurring", "Recurring", Repeat],
                ["on_demand", "On-Demand", Zap],
              ] as const
            ).map(([k, label, I]) => (
              <button key={k} onClick={() => setSub(k)} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold ${sub === k ? "bg-hive-700 text-white" : "text-ink-700 hover:bg-hive-50"}`}>
                <I className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <PaymentTable key={sub} view={sub} />
        </>
      )}
      {tab === "history" && <PaymentTable view="history" />}
    </>
  );
}

/* ───────────── Sales Order (was Payment Details) ───────────── */

function PlanTable() {
  const [f, setF] = useState({ q: "", type: "", page: 1 });
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("clients:sales_order");
  const toast = useToast();
  const load = useCallback(() => api(`/co/clients-plans${qs(f)}`).then(setData), [f]);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const row = (x: any) => ({ serviceType: x.serviceType, rate: Number(x.rate), type: x.type, frequency: x.frequency, startDate: x.type === "recurring" ? fromIst(x.startDate) : undefined });
      if (form._id) {
        if (form.rate === "" || isNaN(Number(form.rate))) throw new Error("Enter the rate");
        await api(`/co/clients-plans/${form._id}`, { method: "PUT", body: { clientId: form.clientId, ...row(form) } });
        toast("ok", "Payment details updated");
      } else {
        const rows = (form.rows || []).filter((x: any) => x.on && !x.exists);
        if (!form.clientId) throw new Error("Pick a client");
        if (!rows.length) throw new Error("Tick at least one service and enter its rate");
        const bad = rows.find((x: any) => x.rate === "" || isNaN(Number(x.rate)));
        if (bad) throw new Error(`Enter the rate for “${bad.serviceType}”`);
        const r = await api<any>("/co/clients-plans/batch", { body: { clientId: form.clientId, lines: rows.map(row) } });
        toast("ok", `Saved ${r.created} service${r.created > 1 ? "s" : ""}${rows.some((x: any) => x.type === "recurring") ? " — invoices appear under Invoice › Recurring" : ""}`);
      }
      setForm(null);
      load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remind(p: any) {
    try {
      await api(`/co/clients-plans/${p._id}/reminder`, { method: "POST" });
      toast("ok", `Reminder sent to ${p.clientName || p.clientCode} on WhatsApp`);
      load();
    } catch (e: any) {
      toast("err", e.message);
    }
  }
  const setType = (type: string) => setForm({ ...form, type, frequency: type === "on_demand" ? "on_demand" : form.frequency === "on_demand" ? "monthly" : form.frequency });

  // Create: picking a client lists its services / products with their No of Licenses (from Lead / Client)
  async function pickClient(clientId: string) {
    setForm((f: any) => ({ ...f, clientId, rows: null }));
    if (!clientId) return;
    try {
      const x = await api<any>(`/co/clients/${clientId}`);
      const existing = new Set((x.plans || []).filter((p: any) => p.active !== false).map((p: any) => `${p.serviceType.toLowerCase()}`));
      const rows = linesOf(x.client).map((l) => ({ serviceType: l.service, licenses: l.licenses, rate: "", type: "recurring", frequency: "monthly", startDate: today(), on: !existing.has(l.service.toLowerCase()), exists: existing.has(l.service.toLowerCase()) }));
      setForm((f: any) => (f?.clientId === clientId ? { ...f, rows } : f));
    } catch (e: any) {
      toast("err", e.message);
    }
  }
  const setRow = (i: number, p: any) => setForm((f: any) => ({ ...f, rows: f.rows.map((r: any, j: number) => (j === i ? { ...r, ...p } : r)) }));

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input w-64 pl-9" placeholder="Client or service" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
        </div>
        <select className="input w-auto" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, page: 1 })} aria-label="Payment type">
          <option value="">Recurring & On-Demand</option>
          <option value="recurring">Recurring</option>
          <option value="on_demand">On-Demand</option>
        </select>
        {perm.create && (
          <Btn className="ml-auto" onClick={() => setForm({ clientId: "", rows: null })}>
            <Plus className="h-4 w-4" /> Create
          </Btn>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              {["Client", "Service Type", "Licenses", "Rate", "Payment Amount", "Payment Type", "Frequency", "Starts", "Action"].map((h) => (
                <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((p: any) => (
              <tr key={p._id} className="hover:bg-hive-50/40">
                <td className="td">
                  <p className="font-semibold">{p.clientName || "NA"}</p>
                  <p className="mono text-xs text-hive-800">{p.clientCode}</p>
                </td>
                <td className="td">{p.serviceType}</td>
                <td className="td tabular-nums">{p.licenses ?? 1}</td>
                <td className="td tabular-nums text-ink-700">{p.rate != null ? inr(p.rate) : "—"}</td>
                <td className="td font-semibold tabular-nums">{inr(p.amount)}</td>
                <td className="td">{p.type === "recurring" ? "Recurring" : "On-Demand"}</td>
                <td className="td">{clientFreqLabel(p.frequency)}</td>
                <td className="td text-ink-700">{p.startDate ? fmtDate(p.startDate, false) : "—"}</td>
                <td className="td">
                  <div className="flex justify-end gap-1">
                    {perm.update && (
                      <button className="btn-ghost" title="Edit" aria-label="Edit" onClick={() => setForm({ ...p, rate: String(p.rate ?? round2(p.amount / (p.licenses || 1))), licenses: p.licenses ?? 1, startDate: istDate(p.startDate) || today(), clientId: String(p.clientId) })}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {perm.delete && (
                      <button className="btn-ghost text-red-600" title="Delete" aria-label="Delete" onClick={() => setDel(p)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    {perm.update && (
                      <button className="btn-ghost" title={p.lastReminderAt ? `Reminder · last sent ${fmtDate(p.lastReminderAt)}` : "Reminder"} aria-label="Reminder" onClick={() => remind(p)}>
                        <BellRing className="h-4 w-4" />
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
        {data && !data.items.length && <Empty title="No sales orders yet" hint="Create one per client — each service gets its rate and terms; recurring ones raise their invoices automatically." />}
      </div>
      {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? "Edit sales order" : "Create sales order"}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Btn>
            <Btn loading={busy} onClick={save}>
              Save
            </Btn>
          </>
        }
      >
        {form && !form._id && (
          <div className="min-h-[420px] space-y-4">
            <Field label="Client" required>
              <ClientSelect value={form.clientId} onChange={pickClient} />
            </Field>
            {form.clientId && !form.rows && (
              <div className="flex justify-center py-6 text-hive-700">
                <Spinner className="h-5 w-5" />
              </div>
            )}
            {form.rows && !form.rows.length && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">This client has no services yet. Add services and their No of Licenses on the client (Client › Edit), then come back.</p>}
            {form.rows?.map((r: any, i: number) => (
              <PlanRow key={r.serviceType} r={r} onChange={(p) => setRow(i, p)} />
            ))}
            {form.rows?.length > 0 && <p className="text-xs text-ink-500">No of Licenses comes from the client’s services (Lead / Client › Edit) and updates here automatically. Payment Amount = Rate × Licenses.</p>}
          </div>
        )}
        {form && form._id && <PlanRow edit r={form} onChange={(p) => setForm({ ...form, ...p })} />}
      </Modal>
      <Confirm
        open={!!del}
        title="Delete this sales order?"
        body={del ? `${del.clientCode} · ${del.serviceType} · ${inr(del.amount)}. Unpaid invoices raised from it are removed; paid ones stay in Pay-In.` : ""}
        confirmLabel="Delete"
        danger
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await api(`/co/clients-plans/${del._id}`, { method: "DELETE" });
          toast("ok", "Deleted");
          setDel(null);
          load();
        }}
      />
    </div>
  );
}

/** One service / product of a client: licences (read-only, from the client) + rate, type, frequency, first due date. */
function PlanRow({ r, onChange, edit }: { r: any; onChange: (p: any) => void; edit?: boolean }) {
  const amount = r.rate !== "" && !isNaN(Number(r.rate)) ? round2(Number(r.rate) * (Number(r.licenses) || 1)) : null;
  const off = !edit && (!r.on || r.exists);
  const setType = (type: string) => onChange({ type, frequency: type === "on_demand" ? "on_demand" : r.frequency === "on_demand" ? "monthly" : r.frequency });
  return (
    <div className={`rounded-2xl border p-4 transition ${off ? "border-ink-400/15 bg-ink-400/5" : "border-hive-200 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2.5">
          {!edit && <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={!!r.on && !r.exists} disabled={r.exists} onChange={(e) => onChange({ on: e.target.checked })} />}
          <span className="font-semibold text-ink-900">{r.serviceType}</span>
        </label>
        {r.exists ? <span className="text-xs font-semibold text-ink-500">Already in a sales order — edit it from the list</span> : amount != null ? <span className="text-sm font-bold tabular-nums text-hive-800">Payment Amount {inr(amount)}</span> : null}
      </div>
      {!off && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="No of Licenses" hint="From the client">
            <input className="input bg-[#f7f8f6] tabular-nums" readOnly value={r.licenses ?? 1} />
          </Field>
          <Field label="Rate (₹ per licence)" required>
            <input className="input tabular-nums" inputMode="decimal" placeholder="0" value={r.rate} onChange={(e) => onChange({ rate: e.target.value.replace(/[^\d.]/g, "") })} />
          </Field>
          <Field label="Payment Type" required>
            <div className="flex rounded-xl border border-ink-400/20 bg-white p-1">
              {[
                ["recurring", "Recurring"],
                ["on_demand", "On-Demand"],
              ].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setType(k)} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${r.type === k ? "bg-hive-700 text-white" : "text-ink-700"}`}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Payment Frequency" required>
            <select className="input" value={r.frequency} disabled={r.type === "on_demand"} onChange={(e) => onChange({ frequency: e.target.value })}>
              {CLIENT_FREQUENCIES.filter((x) => (r.type === "on_demand" ? x.key === "on_demand" : x.key !== "on_demand")).map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
          {r.type === "recurring" ? (
            <Field label="First due date" hint="Next dues follow the frequency">
              <input type="date" className="input" value={r.startDate} onChange={(e) => onChange({ startDate: e.target.value })} />
            </Field>
          ) : (
            <p className="self-end text-xs text-ink-500 sm:col-span-2">On-demand prices fill in automatically when you create an On-Demand payment for this client and service.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Pick files (multiple), shown as removable chips; checks type and size before upload. */
function FilePick({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const toast = useToast();
  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-hive-200 bg-hive-50/50 px-4 py-5 text-center hover:bg-hive-50">
        <Paperclip className="mb-1 h-5 w-5 text-hive-600" />
        <span className="text-sm font-semibold">Attach files</span>
        <span className="text-xs text-ink-500">PDF, images, Word, Excel · up to {ATTACHMENT_MAX_MB} MB each · max 10</span>
        <input
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const add = Array.from(e.target.files || []);
            const big = add.find((f) => f.size > ATTACHMENT_MAX_MB * 1024 * 1024);
            if (big) toast("err", `${big.name} is larger than ${ATTACHMENT_MAX_MB} MB`);
            setFiles([...files, ...add.filter((f) => f.size <= ATTACHMENT_MAX_MB * 1024 * 1024)].slice(0, 10));
            e.target.value = "";
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg bg-hive-50/70 px-3 py-1.5 text-sm">
              <Paperclip className="h-3.5 w-3.5 text-hive-600" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-ink-400">{(f.size / 1024).toFixed(0)} KB</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X className="h-4 w-4 text-ink-400 hover:text-red-600" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Invoice → Paid: when, how, transaction ID, remarks and proof of payment (S3 …/<Client Code>/Payment/). */
function PaidModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: (files: number) => void }) {
  const [f, setF] = useState<any>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const me: any = useMe();
  const toast = useToast();
  useEffect(() => {
    if (p) {
      setF({ paidAt: today(), mode: p.mode || "", txnId: p.txnId || "", remarks: p.remarks || "" });
      setFiles([]);
    }
  }, [p]);
  async function save() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("data", JSON.stringify({ ...f, paidAt: fromIst(f.paidAt) }));
      files.forEach((x) => fd.append("files", x));
      await api(`/co/clients-payments/${p._id}/pay`, { form: fd });
      onDone(files.length);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!p}
      onClose={onClose}
      title="Mark invoice as Paid"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn loading={busy} onClick={save}>
            Mark Paid
          </Btn>
        </>
      }
    >
      {p && f && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-hive-50/70 px-4 py-3 text-sm sm:col-span-2">
            <p className="font-semibold">
              {p.clientName || p.clientCode} · <span className="tabular-nums">{inr(p.gross)}</span>
            </p>
            <p className="text-ink-500">
              {p.services.join(", ")} · due {fmtDate(p.dueDate, false)}
            </p>
          </div>
          <Field label="Paid on" required>
            <input type="date" className="input" max={today()} value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} />
          </Field>
          <Field label="Payment Mode">
            <select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
              <option value="">Select…</option>
              {PAYMENT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Transaction ID" className="sm:col-span-2">
            <input className="input font-mono" maxLength={80} value={f.txnId} onChange={(e) => setF({ ...f, txnId: e.target.value })} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <textarea className="input min-h-[60px]" maxLength={1000} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <p className="label">Attachment</p>
            <FilePick files={files} setFiles={setFiles} />
            <p className="mt-1.5 text-xs text-ink-500">
              Saved to the client’s <b>Payment</b> folder: <span className="mono">{me?.companyCode ? `${me.companyCode}/` : ""}{p.clientCode}/Payment/</span>
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Files attached to an invoice: download, remove, add more (paid invoices). */
function AttachmentsModal({ p, canEdit, onClose, onChanged }: { p: any; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    setList(p?.attachments || []);
    setFiles([]);
  }, [p]);
  async function upload() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("data", "{}");
      files.forEach((x) => fd.append("files", x));
      const r = await api<any>(`/co/clients-payments/${p._id}/pay`, { form: fd });
      setList(r.attachments || []);
      setFiles([]);
      toast("ok", "Attachment saved");
      onChanged();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!p} onClose={onClose} title={p ? `Attachments · ${p.clientName || p.clientCode}` : ""} size="md">
      {p && (
        <div className="space-y-4">
          {list.length ? (
            <ul className="divide-y divide-ink-400/10 rounded-xl border border-ink-400/15">
              {list.map((a) => (
                <li key={a._id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <Paperclip className="h-4 w-4 text-hive-600" />
                  <div className="min-w-0 flex-1">
                    <a className="block truncate font-semibold text-hive-800 hover:underline" href={`/api/co/clients-payments/${p._id}/attachments/${a._id}?inline=1`} target="_blank" rel="noreferrer">
                      {a.fileName}
                    </a>
                    <p className="text-xs text-ink-500">
                      {a.type} · {(a.size / 1024).toFixed(0)} KB · {fmtDate(a.at)}
                      {a.by ? ` · ${a.by}` : ""}
                    </p>
                  </div>
                  <a className="btn-ghost" href={`/api/co/clients-payments/${p._id}/attachments/${a._id}`} title="Download" aria-label="Download">
                    <Download className="h-4 w-4" />
                  </a>
                  {canEdit && (
                    <button
                      className="btn-ghost text-red-600"
                      title="Remove"
                      aria-label="Remove"
                      onClick={async () => {
                        if (!confirm(`Remove ${a.fileName}?`)) return;
                        await api(`/co/clients-payments/${p._id}/attachments/${a._id}`, { method: "DELETE" });
                        setList(list.filter((x) => x._id !== a._id));
                        onChanged();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">No attachments yet.</p>
          )}
          {canEdit && p.status === "paid" && (
            <>
              <FilePick files={files} setFiles={setFiles} />
              {files.length > 0 && (
                <Btn loading={busy} onClick={upload}>
                  Upload {files.length} file{files.length > 1 ? "s" : ""}
                </Btn>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ───────────── Payments (Recurring · On-Demand · History) ───────────── */
const BLANK_PAY = { clientId: "", services: [] as string[], amount: "", discountType: "fixed", discountFixed: "", discountPct: "", status: "unpaid", mode: "", txnId: "", remarks: "", dueDate: today() };

function PaymentTable({ view }: { view: View }) {
  const [f, setF] = useState({ q: "", status: "", page: 1 });
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<any>(null); // Invoice → Paid pop-up
  const [files, setFiles] = useState<any>(null); // attachments of one invoice
  const invPerm = usePerm("clients:invoice"), payinPerm = usePerm("clients:payin");
  const perm = view === "history" ? payinPerm : invPerm; // the tab's own sub-module
  const rowPerm = (p: any) => (p.status === "paid" ? payinPerm : invPerm); // a paid row is Pay-In
  const toast = useToast();
  const load = useCallback(() => api(`/co/clients-payments${qs({ ...f, view })}`).then(setData), [f, view]);
  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(p: any, status: string) {
    if (status === "paid") return setPaying(p); // Paid → pop-up with date, mode, transaction ID and attachments
    try {
      await api(`/co/clients-payments/${p._id}`, { method: "PUT", body: { status } });
      toast("ok", view === "history" ? `Moved back to Invoice as ${PAY_STATUS[status].label}` : `Status → ${PAY_STATUS[status].label}`);
      load();
    } catch (e: any) {
      toast("err", e.message);
    }
  }
  async function remind(p: any) {
    try {
      await api(`/co/clients-payments/${p._id}/reminder`, { method: "POST" });
      toast("ok", `${p.status === "paid" ? "Receipt" : "Reminder"} sent to ${p.clientName || p.clientCode} on WhatsApp`);
      load();
    } catch (e: any) {
      toast("err", e.message);
    }
  }
  const openEdit = (p: any) =>
    setForm({
      ...p,
      clientId: String(p.clientId),
      amount: String(p.amount),
      discountFixed: p.discountAmount ? String(p.discountAmount) : "",
      discountPct: p.discountAmount && p.amount ? String(Math.round((p.discountAmount / p.amount) * 10000) / 100) : "",
      mode: p.mode || "",
      txnId: p.txnId || "",
      remarks: p.remarks || "",
      dueDate: istDate(p.dueDate),
    });

  async function save() {
    setBusy(true);
    try {
      if (form._id && view === "history") {
        await api(`/co/clients-payments/${form._id}`, { method: "PUT", body: { status: form.status } });
      } else {
        const body: any = {
          amount: Number(form.amount || 0),
          discountType: form.discountType,
          discountValue: Number((form.discountType === "percent" ? form.discountPct : form.discountFixed) || 0),
          status: form.status,
          mode: form.mode || null,
          txnId: form.txnId,
          remarks: form.remarks,
        };
        if (!form._id || form.kind === "on_demand") Object.assign(body, { clientId: form.clientId, services: form.services, dueDate: fromIst(form.dueDate) });
        if (form._id) await api(`/co/clients-payments/${form._id}`, { method: "PUT", body });
        else await api("/co/clients-payments", { body });
      }
      toast("ok", form.status === "paid" && view !== "history" ? "Saved — paid invoices move to Pay-In" : "Saved");
      setForm(null);
      load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  const sums = data?.sums || {};
  const heads = view === "history" ? ["Client", "Service Type", "Type", "Gross", "Paid on", "Mode", "Transaction ID", "Payment Status", "Action"] : view === "recurring" ? ["Client", "Service Type", "Due date", "Payment Amount", "Gross", "Payment Status", "Action"] : ["Client", "Service Type", "Payment Amount", "Discount", "Gross", "Due date", "Payment Status", "Mode", "Action"];

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {view === "history" ? (
          <Stat label="Collected" value={inr(sums.paid?.amount || 0)} hint={`${sums.paid?.n || 0} payment(s)`} tone="green" />
        ) : (
          <>
            <Stat label="Unpaid" value={inr(sums.unpaid?.amount || 0)} hint={`${sums.unpaid?.n || 0} due`} tone="honey" />
            <Stat label="Over-Due" value={inr(sums.overdue?.amount || 0)} hint={`${sums.overdue?.n || 0} late`} tone="red" />
          </>
        )}
      </div>
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input w-64 pl-9" placeholder="Client, service, transaction ID" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
          </div>
          {view !== "history" && (
            <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} aria-label="Payment status">
              <option value="">Unpaid & Over-Due</option>
              <option value="unpaid">Unpaid</option>
              <option value="overdue">Over-Due</option>
            </select>
          )}
          {view === "on_demand" && perm.create && (
            <Btn className="ml-auto" onClick={() => setForm({ ...BLANK_PAY })}>
              <Plus className="h-4 w-4" /> Create
            </Btn>
          )}
          {view === "recurring" && <p className="ml-auto text-xs text-ink-500">Raised automatically from recurring Sales Orders.</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr>
                {heads.map((h) => (
                  <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((p: any) => (
                <tr key={p._id} className="hover:bg-hive-50/40">
                  <td className="td">
                    <p className="font-semibold">{p.clientName || "NA"}</p>
                    <p className="mono text-xs text-hive-800">{p.clientCode}</p>
                  </td>
                  <td className="td max-w-[220px]">{p.services.join(", ")}</td>
                  {view === "history" ? (
                    <>
                      <td className="td">{p.kind === "recurring" ? "Recurring" : "On-Demand"}</td>
                      <td className="td font-semibold tabular-nums">{inr(p.gross)}</td>
                      <td className="td">{fmtDate(p.paidAt)}</td>
                      <td className="td">{p.mode || "NA"}</td>
                      <td className="td mono">{p.txnId || "NA"}</td>
                    </>
                  ) : view === "recurring" ? (
                    <>
                      <td className="td">{fmtDate(p.dueDate, false)}</td>
                      <td className="td tabular-nums">{inr(p.amount)}</td>
                      <td className="td font-semibold tabular-nums">{inr(p.gross)}</td>
                    </>
                  ) : (
                    <>
                      <td className="td tabular-nums">{inr(p.amount)}</td>
                      <td className="td tabular-nums">{p.discountAmount ? `${inr(p.discountAmount)}${p.discountType === "percent" ? ` (${p.discountValue}%)` : ""}` : "—"}</td>
                      <td className="td font-semibold tabular-nums">{inr(p.gross)}</td>
                      <td className="td">{fmtDate(p.dueDate, false)}</td>
                    </>
                  )}
                  <td className="td">
                    <select className={`rounded-lg border-0 py-1 pl-2 pr-7 text-xs font-semibold ring-1 ring-inset ring-ink-400/20 ${PAY_STATUS[p.status].cls}`} value={p.status} disabled={!rowPerm(p).update} onChange={(e) => setStatus(p, e.target.value)} aria-label="Payment status">
                      {Object.entries(PAY_STATUS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {view === "on_demand" && <td className="td">{p.mode || "NA"}</td>}
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      {rowPerm(p).update && (
                        <button className="btn-ghost" title={view === "history" ? "Edit status" : "Edit"} aria-label="Edit" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {(p.attachments?.length > 0 || p.status === "paid") && (
                        <button className="btn-ghost relative" title={p.attachments?.length ? `${p.attachments.length} attachment(s)` : "Attachments"} aria-label="Attachments" onClick={() => setFiles(p)}>
                          <Paperclip className="h-4 w-4" />
                          {p.attachments?.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-hive-700 px-1 text-[10px] font-bold text-white">{p.attachments.length}</span>}
                        </button>
                      )}
                      {rowPerm(p).delete && (
                        <button className="btn-ghost text-red-600" title="Delete" aria-label="Delete" onClick={() => setDel(p)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      {rowPerm(p).update && (
                        <button className="btn-ghost" title={p.status === "paid" ? "Send receipt on WhatsApp" : p.lastReminderAt ? `Reminder · last sent ${fmtDate(p.lastReminderAt)}` : "Reminder"} aria-label="Reminder" onClick={() => remind(p)}>
                          <BellRing className="h-4 w-4" />
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
          {data && !data.items.length && <Empty title={view === "history" ? "No payments received yet" : "No invoices due"} hint={view === "recurring" ? "Recurring Sales Orders raise their invoices here automatically." : view === "on_demand" ? "Create a one-off invoice for a client." : "Invoices marked Paid appear here, with their attachments."} />}
        </div>
        {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </div>

      <PaymentForm form={form} setForm={setForm} view={view} busy={busy} onSave={save} />
      <PaidModal
        p={paying}
        onClose={() => setPaying(null)}
        onDone={(n) => {
          setPaying(null);
          toast("ok", `Marked Paid${n ? ` · ${n} attachment${n > 1 ? "s" : ""} saved` : ""} — moved to Pay-In`);
          load();
        }}
      />
      <AttachmentsModal p={files} canEdit={!!files && rowPerm(files).update} onClose={() => setFiles(null)} onChanged={load} />
      <Confirm
        open={!!del}
        title="Delete this payment?"
        body={del ? `${del.clientCode} · ${del.services.join(", ")} · ${inr(del.gross)}` : ""}
        confirmLabel="Delete"
        danger
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await api(`/co/clients-payments/${del._id}`, { method: "DELETE" });
          toast("ok", "Deleted");
          setDel(null);
          load();
        }}
      />
    </>
  );
}

function PaymentForm({ form, setForm, view, busy, onSave }: { form: any; setForm: (f: any) => void; view: View; busy: boolean; onSave: () => void }) {
  const [pricing, setPricing] = useState<{ missing: string[] } | null>(null);
  const lastKey = useRef("");
  const statusOnly = !!form?._id && view === "history";
  const pickable = !!form && (!form._id || form.kind === "on_demand");

  // Amount fills in from the client's Sales Order for the chosen services (still editable)
  useEffect(() => {
    if (!form || !pickable || !form.clientId || !form.services?.length) return;
    const key = `${form.clientId}|${form.services.join(",")}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    api(`/co/clients/price${qs({ clientId: form.clientId, services: form.services.join(",") })}`)
      .then((r) => {
        setPricing({ missing: r.missing });
        if (r.amount > 0) setForm((f: any) => (f ? { ...f, amount: String(r.amount), ...linked(String(r.amount), f.discountType, f.discountType === "percent" ? f.discountPct : f.discountFixed) } : f));
      })
      .catch(() => undefined);
  }, [form?.clientId, form?.services?.join(","), pickable]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!form) {
      lastKey.current = "";
      setPricing(null);
    }
  }, [form]);

  if (!form) return null;
  /** Fixed ⇄ % — whichever was typed drives the other. */
  function linked(amount: string, type: string, value: string) {
    const a = Number(amount || 0);
    const v = Number(value || 0);
    const d = applyDiscount(a, type as any, v);
    return type === "percent" ? { discountType: "percent", discountPct: value, discountFixed: value ? String(d.discountAmount) : "" } : { discountType: "fixed", discountFixed: value, discountPct: value && a ? String(d.percent) : "" };
  }
  const calc = applyDiscount(Number(form.amount || 0), form.discountType, Number((form.discountType === "percent" ? form.discountPct : form.discountFixed) || 0));
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  return (
    <Modal
      open
      onClose={() => setForm(null)}
      title={statusOnly ? "Update invoice status" : form._id ? "Edit invoice" : "Create On-Demand invoice"}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={() => setForm(null)}>
            Cancel
          </Btn>
          <Btn loading={busy} onClick={onSave}>
            Save
          </Btn>
        </>
      }
    >
      {statusOnly ? (
        <div className="space-y-4">
          <p className="rounded-xl bg-[#f6f7f5] p-3 text-sm">
            <b>{form.clientName}</b> <span className="mono text-hive-800">{form.clientCode}</span> · {form.services.join(", ")} · <b>{inr(form.gross)}</b>
            <br />
            <span className="text-ink-500">
              Paid {fmtDate(form.paidAt)} {form.mode ? `· ${form.mode}` : ""} {form.txnId ? `· ${form.txnId}` : ""}
            </span>
          </p>
          <Field label="Payment Status" hint="Only the status can change here. Unpaid / Over-Due moves it back to Invoice.">
            <select className="input" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {Object.entries(PAY_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" required className="sm:col-span-2">
            <ClientSelect value={form.clientId} disabled={!pickable} onChange={(v) => set("clientId", v)} />
          </Field>
          <Field label="Service Type" required className="sm:col-span-2" hint={pricing?.missing?.length ? `No price in the Sales Order for: ${pricing.missing.join(", ")} — enter the amount` : "Multi-select · search or add new"}>
            {pickable ? <ServicePicker value={form.services} onChange={(v) => set("services", v)} placeholder="Select service type(s)…" /> : <input className="input" disabled value={form.services.join(", ")} />}
          </Field>
          <Field label="Payment Amount (₹)" required hint={pickable ? "Filled from the client's Sales Order — can be changed" : undefined}>
            <input className="input tabular-nums" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, ""), ...linked(e.target.value.replace(/[^\d.]/g, ""), form.discountType, form.discountType === "percent" ? form.discountPct : form.discountFixed) })} />
          </Field>
          {pickable && (
            <Field label="Due date">
              <input type="date" className="input" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </Field>
          )}
          <Field label="Discount applied" className="sm:col-span-2" hint="Enter either — the other is calculated">
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
                <input className="input pl-7 tabular-nums" inputMode="decimal" placeholder="Fixed" value={form.discountFixed} onChange={(e) => setForm({ ...form, ...linked(form.amount, "fixed", e.target.value.replace(/[^\d.]/g, "")) })} aria-label="Discount amount" />
              </div>
              <div className="relative">
                <input className="input pr-8 tabular-nums" inputMode="decimal" placeholder="Percent" value={form.discountPct} onChange={(e) => setForm({ ...form, ...linked(form.amount, "percent", e.target.value.replace(/[^\d.]/g, "")) })} aria-label="Discount percent" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">%</span>
              </div>
            </div>
          </Field>
          <Field label="Gross" hint="Payment amount − discount">
            <input className="input bg-[#f6f7f5] font-bold tabular-nums" readOnly value={inr(calc.gross)} />
          </Field>
          <Field label="Payment Status">
            <select className="input" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {Object.entries(PAY_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment Mode">
            <select className="input" value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              <option value="">Select…</option>
              {PAYMENT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Payment Transaction ID">
            <input className="input font-mono" maxLength={80} value={form.txnId} onChange={(e) => set("txnId", e.target.value)} />
          </Field>
          <Field label="Payment Remarks" className="sm:col-span-2">
            <textarea className="input min-h-[70px]" maxLength={1000} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

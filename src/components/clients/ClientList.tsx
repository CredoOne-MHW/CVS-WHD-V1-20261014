"use client";
import { useCallback, useEffect, useState } from "react";
import { Search, Eye, UserPlus, Flag, LifeBuoy, IndianRupee, CircleDollarSign, StickyNote, Briefcase, ArrowRightLeft } from "lucide-react";
import { api, qs, fmtDate, inr } from "@/lib/api";
import { Btn, Modal, Field, Badge, Empty, Pager, Spinner, useToast } from "../ui";
import { usePerm } from "../Shell";
import { useServices } from "../ServicePicker";
import { BusinessFields, ServiceField, bizFrom, bizPayload, bizError, linesError, linesPayload } from "../BusinessFields";
import { linesOf } from "@shared/clients";
import { STAGE_DOT, TICKET_STYLE, PAY_STATUS } from "./common";

const EVENT_ICON: Record<string, any> = { lead: UserPlus, status: Flag, note: StickyNote, ticket: LifeBuoy, payment: IndianRupee, paid: CircleDollarSign };

export function ClientList() {
  const [f, setF] = useState({ q: "", stage: "", service: "", page: 1 });
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const services = useServices();
  const load = useCallback(() => api(`/co/clients${qs(f)}`).then(setData), [f]);
  useEffect(() => {
    load();
  }, [load]);
  const col = (id: string) => data?.columns.find((c: any) => c.id === id) || data?.columns[0];

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input w-72 pl-9" placeholder="Search Client ID, name, phone, email" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
        </div>
        <select className="input w-auto" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value, page: 1 })} aria-label="Service status">
          <option value="">All service statuses</option>
          {data?.columns.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value, page: 1 })} aria-label="Service">
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s._id}>{s.name}</option>
          ))}
        </select>
        {data && <span className="ml-auto text-sm text-ink-500">{data.total} client(s)</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr>
              {["Client ID", "Name", "Contact", "Service", "Service status", "Outstanding", "Client since", "Action"].map((h) => (
                <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((c: any) => {
              const st = col(c.serviceStage);
              return (
                <tr key={c._id} className="hover:bg-hive-50/40">
                  <td className="td mono font-semibold text-hive-800">{c.clientCode}</td>
                  <td className="td">
                    <button className="text-left font-semibold text-ink-900 hover:text-hive-700" onClick={() => setOpen(c._id)}>
                      {c.name || "NA"}
                    </button>
                    {c.business?.gst && <p className="mono text-xs text-ink-400">GST {c.business.gst}</p>}
                  </td>
                  <td className="td">
                    <p className="mono">{c.whatsapp || c.phone || "NA"}</p>
                    <p className="max-w-[200px] truncate text-xs text-ink-500">{c.email || ""}</p>
                  </td>
                  <td className="td max-w-[220px]">
                    <div className="flex flex-wrap gap-1">
                      {linesOf(c).length ? linesOf(c).map((s) => <Badge key={s.service}>{s.service}{s.licenses > 1 ? ` × ${s.licenses}` : ""}</Badge>) : <span className="text-ink-400">NA</span>}
                    </div>
                  </td>
                  <td className="td">
                    {st && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f6f7f5] px-2.5 py-1 text-xs font-semibold text-ink-700">
                        <span className="h-2 w-2 rounded-full" style={STAGE_DOT(st.color)} /> {st.name}
                      </span>
                    )}
                  </td>
                  <td className="td">{c.outstanding ? <span className="font-semibold text-red-700">{inr(c.outstanding.amount)}</span> : <span className="text-ink-400">—</span>}</td>
                  <td className="td text-ink-700">{fmtDate(c.clientSince, false)}</td>
                  <td className="td text-right">
                    <button className="btn-ghost" title="View journey" aria-label="View journey" onClick={() => setOpen(c._id)}>
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data && (
          <div className="flex justify-center py-16 text-hive-700">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {data && !data.items.length && <Empty title="No clients yet" hint={`A lead becomes a client when its status is set to “Converted / Service Initiated”.`} />}
      </div>
      {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      <ClientProfile id={open} onClose={() => setOpen(null)} onSaved={load} />
    </div>
  );
}

/** Profile + journey of one client. */
export function ClientProfile({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved?: () => void }) {
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("clients:clients");
  const toast = useToast();
  useEffect(() => {
    setD(null);
    if (!id) return;
    api(`/co/clients/${id}`).then((x) => {
      setD(x);
      const c = x.client;
      setForm({ name: c.name || "", phone: c.phone || "", whatsapp: c.whatsapp || "", email: c.email || "", address: c.address || "", serviceLines: linesOf(c), biz: bizFrom(c.business), remark: "" });
    });
  }, [id]);

  async function save() {
    const err = linesError(form.serviceLines) || bizError(form.biz);
    if (err) return toast("err", err);
    setBusy(true);
    try {
      const { biz, serviceLines, ...rest } = form;
      await api(`/co/clients/${id}`, { method: "PUT", body: { ...rest, serviceLines: linesPayload(serviceLines), remark: rest.remark || undefined, business: bizPayload(biz) } });
      toast("ok", "Client updated");
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  const c = d?.client;
  const stage = d && (d.columns.find((x: any) => x.id === c.serviceStage) || d.columns[0]);
  const u = (k: string, v: any) => setForm({ ...form, [k]: v });

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="xl"
      title={
        c ? (
          <span className="flex items-center gap-2.5">
            <Briefcase className="h-5 w-5 text-hive-700" /> {c.name || "Client"} <span className="mono rounded-lg bg-hive-50 px-2 py-0.5 text-sm text-hive-800">{c.clientCode}</span>
          </span>
        ) : (
          "Client"
        )
      }
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Close
          </Btn>
          {perm.update && form && (
            <Btn loading={busy} onClick={save}>
              Save
            </Btn>
          )}
        </>
      }
    >
      {!d || !form ? (
        <div className="flex justify-center py-16 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="grid content-start gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className="input" value={form.name} disabled={!perm.update} onChange={(e) => u("name", e.target.value)} />
            </Field>
            <Field label="Email ID">
              <input className="input" type="email" placeholder="NA" value={form.email} disabled={!perm.update} onChange={(e) => u("email", e.target.value)} />
            </Field>
            <Field label="WhatsApp No">
              <input className="input" inputMode="numeric" maxLength={10} placeholder="NA" value={form.whatsapp} disabled={!perm.update} onChange={(e) => u("whatsapp", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Phone No">
              <input className="input" inputMode="numeric" maxLength={10} placeholder="NA" value={form.phone} disabled={!perm.update} onChange={(e) => u("phone", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <input className="input" placeholder="NA" value={form.address} disabled={!perm.update} onChange={(e) => u("address", e.target.value)} />
            </Field>
            <ServiceField lines={form.serviceLines} onChange={(s) => u("serviceLines", s)} />
            <BusinessFields v={form.biz} set={(biz) => u("biz", biz)} />
            {perm.update && (
              <Field label="Add a note to the journey" className="sm:col-span-2">
                <textarea className="input min-h-[70px]" value={form.remark} onChange={(e) => u("remark", e.target.value)} placeholder="e.g. Kick-off call done, documents received" />
              </Field>
            )}
          </div>
          <aside className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-red-50/70 p-3.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-red-700/80">Outstanding</p>
                <p className="mt-1 text-lg font-extrabold text-red-700">{inr(d.totals.outstanding)}</p>
              </div>
              <div className="rounded-2xl bg-hive-50 p-3.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-hive-700/80">Paid</p>
                <p className="mt-1 text-lg font-extrabold text-hive-800">{inr(d.totals.paid)}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-ink-400/15 p-3.5 text-sm">
              <p className="flex items-center justify-between">
                <span className="text-ink-500">Service status</span>
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <span className="h-2 w-2 rounded-full" style={STAGE_DOT(stage?.color)} />
                  {stage?.name}
                </span>
              </p>
              <p className="mt-1.5 flex items-center justify-between">
                <span className="text-ink-500">Client since</span> <span className="font-semibold">{fmtDate(c.clientSince, false)}</span>
              </p>
              <p className="mt-1.5 flex items-center justify-between">
                <span className="text-ink-500">Open tickets</span> <span className="font-semibold">{d.tickets.filter((t: any) => !["Resolved", "Closed"].includes(t.status)).length}</span>
              </p>
              <p className="mt-1.5 flex items-center justify-between">
                <span className="text-ink-500">Sales order lines</span> <span className="font-semibold">{d.plans.length}</span>
              </p>
            </div>
            {d.tickets.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Tickets</p>
                <ul className="space-y-1.5">
                  {d.tickets.slice(0, 5).map((t: any) => (
                    <li key={t._id} className="flex items-center justify-between gap-2 rounded-xl border border-ink-400/10 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate">
                        <b className="mono">{t.ticketNo}</b> · {t.category}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${TICKET_STYLE[t.status]}`}>{t.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.payments.some((p: any) => p.status !== "paid") && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Dues</p>
                <ul className="space-y-1.5">
                  {d.payments
                    .filter((p: any) => p.status !== "paid")
                    .slice(0, 5)
                    .map((p: any) => (
                      <li key={p._id} className="flex items-center justify-between gap-2 rounded-xl border border-ink-400/10 px-3 py-2 text-xs">
                        <span className="min-w-0 truncate">
                          {fmtDate(p.dueDate, false)} · {p.services.join(", ")}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${PAY_STATUS[p.status].cls}`}>{inr(p.gross)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-500">
                <ArrowRightLeft className="h-3.5 w-3.5" /> Journey
              </p>
              <ol className="max-h-[420px] space-y-3 overflow-y-auto border-l-2 border-hive-100 pl-4">
                {d.events.map((e: any, i: number) => {
                  const I = EVENT_ICON[e.type] || StickyNote;
                  return (
                    <li key={i} className="relative text-xs">
                      <span className="absolute -left-[27px] grid h-5 w-5 place-items-center rounded-full bg-white ring-2 ring-hive-100">
                        <I className="h-3 w-3 text-hive-700" />
                      </span>
                      <p className="text-ink-400">
                        {fmtDate(e.at)}
                        {e.by ? ` · ${e.by}` : ""}
                      </p>
                      <p className="font-semibold text-ink-900">{e.title}</p>
                      {e.detail && e.detail !== e.title && <p className="text-ink-700">{e.detail}</p>}
                    </li>
                  );
                })}
              </ol>
            </div>
          </aside>
        </div>
      )}
    </Modal>
  );
}

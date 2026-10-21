"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, Trash2, ExternalLink, Copy, Eye, MessageCircle } from "lucide-react";
import { api, qs, fmtDate } from "@/lib/api";
import { Btn, Modal, Field, Empty, Pager, Spinner, Confirm, useToast } from "../ui";
import { usePerm, useMe } from "../Shell";
import { TICKET_STATUS_LIST, SUPPORT_CATEGORIES } from "@shared/clients";
import { ClientSelect, TICKET_STYLE } from "./common";

export function Tickets() {
  const [f, setF] = useState({ q: "", status: "", category: "", page: 1 });
  const [data, setData] = useState<any>(null);
  const [upd, setUpd] = useState<{ t: any; status: string; note: string } | null>(null);
  const [view, setView] = useState<any>(null);
  const [add, setAdd] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("clients:tickets");
  const toast = useToast();
  const load = useCallback(() => api(`/co/clients-tickets${qs(f)}`).then(setData), [f]);
  useEffect(() => {
    load();
  }, [load]);

  // the client-facing page of THIS company: <company base URL>/support. Base URL = the company's own URL if set
  // (Super Admin › Company › Branding & domain), else its platform address <slug>.mhw.credovation.tech.
  const me = useMe();
  const portal = useMemo(() => {
    const b: any = me?.branding || {};
    const base = (b.customUrl || b.platformUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
    return base ? `${base}/support` : null;
  }, [me]);
  const counts = data?.counts || {};

  async function saveStatus() {
    if (!upd) return;
    setBusy(true);
    try {
      const r = await api(`/co/clients-tickets/${upd.t._id}`, { method: "PATCH", body: { status: upd.status, note: upd.note || undefined } });
      toast(r.notified ? "ok" : "err", r.notified ? `${upd.t.ticketNo} → ${upd.status} · client notified on WhatsApp` : `${upd.t.ticketNo} → ${upd.status} · WhatsApp not sent: ${r.reason || "no webhook"}`);
      setUpd(null);
      load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {portal && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-hive-200 bg-hive-50/60 p-4 text-sm">
          <MessageCircle className="h-5 w-5 text-hive-700" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-900">Client support page</p>
            <p className="text-ink-700">
              Clients sign in with their Client ID + registered mobile, raise a Support / Request / Grievance and follow it. Every status change is sent to them on WhatsApp (Settings › WhatsApp Webhook › “Support ticket” events).
            </p>
            <a href={portal} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all font-mono text-xs font-semibold text-hive-800 hover:underline">
              {portal}
            </a>
          </div>
          <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(portal).then(() => toast("ok", "Copied"))}>
            <Copy className="h-4 w-4" /> Copy
          </button>
          <a className="btn-secondary" href={portal} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" /> Open
          </a>
        </div>
      )}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {["", ...TICKET_STATUS_LIST].map((s) => (
          <button key={s || "all"} onClick={() => setF({ ...f, status: s, page: 1 })} className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${f.status === s ? "border-hive-700 bg-hive-700 text-white" : "border-ink-400/25 bg-white text-ink-700 hover:bg-hive-50"}`}>
            {s || "All"} <span className="opacity-70">{s ? counts[s] || 0 : Object.values(counts).reduce((a: number, b: any) => a + b, 0)}</span>
          </button>
        ))}
      </div>
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input w-72 pl-9" placeholder="Ticket no., Client ID, name, text" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
          </div>
          <select className="input w-auto" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, page: 1 })} aria-label="Category">
            <option value="">All categories</option>
            {SUPPORT_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {perm.create && (
            <Btn className="ml-auto" onClick={() => setAdd({ clientId: "", category: "Support", description: "" })}>
              <Plus className="h-4 w-4" /> New ticket
            </Btn>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px]">
            <thead>
              <tr>
                {["Ticket", "Client", "Category", "Support needed", "Status", "Updated", "Action"].map((h) => (
                  <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((t: any) => (
                <tr key={t._id} className="hover:bg-hive-50/40">
                  <td className="td">
                    <p className="mono font-semibold">{t.ticketNo}</p>
                    <p className="text-xs text-ink-400">{t.via === "portal" ? "Support page" : "Staff"} · {fmtDate(t.createdAt)}</p>
                  </td>
                  <td className="td">
                    <p className="font-semibold">{t.clientName || "NA"}</p>
                    <p className="mono text-xs text-hive-800">{t.clientCode}</p>
                  </td>
                  <td className="td">{t.category}</td>
                  <td className="td max-w-[320px]">
                    <p className="line-clamp-2 text-ink-700" title={t.description}>
                      {t.description}
                    </p>
                  </td>
                  <td className="td">
                    <select className={`rounded-lg border-0 py-1 pl-2 pr-7 text-xs font-semibold ring-1 ring-inset ring-ink-400/20 ${TICKET_STYLE[t.status]}`} value={t.status} disabled={!perm.update} onChange={(e) => setUpd({ t, status: e.target.value, note: "" })} aria-label="Status">
                      {TICKET_STATUS_LIST.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="td text-ink-700">{fmtDate(t.updatedAt)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost" title="View" aria-label="View" onClick={() => setView(t)}>
                        <Eye className="h-4 w-4" />
                      </button>
                      {perm.delete && (
                        <button className="btn-ghost text-red-600" title="Delete" aria-label="Delete" onClick={() => setDel(t)}>
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
          {data && !data.items.length && <Empty title="No tickets" hint="Tickets raised on the support page appear here." />}
        </div>
        {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </div>

      <Modal
        open={!!upd}
        onClose={() => setUpd(null)}
        title={`${upd?.t.ticketNo} → ${upd?.status}`}
        size="sm"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setUpd(null)}>
              Cancel
            </Btn>
            <Btn loading={busy} onClick={saveStatus}>
              Update & notify
            </Btn>
          </>
        }
      >
        {upd && (
          <Field label="Message to the client (optional)" hint="Added to the WhatsApp update and the ticket history">
            <textarea className="input min-h-[90px]" maxLength={500} value={upd.note} onChange={(e) => setUpd({ ...upd, note: e.target.value })} placeholder={upd.status === "Resolved" ? "e.g. Report re-sent to your email." : "e.g. Our engineer will visit tomorrow 11 AM."} />
          </Field>
        )}
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.ticketNo} · ${view.category}` : ""} size="md">
        {view && (
          <div className="space-y-4">
            <p className="text-sm">
              <b>{view.clientName}</b> <span className="mono text-hive-800">{view.clientCode}</span>
            </p>
            <p className="whitespace-pre-wrap rounded-xl bg-[#f6f7f5] p-3 text-sm text-ink-900">{view.description}</p>
            <ol className="space-y-2.5 border-l-2 border-hive-100 pl-4">
              {view.history.map((h: any, i: number) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold">{h.from ? `${h.from} → ` : ""}{h.to}</span> <span className="text-xs text-ink-500">· {fmtDate(h.at)} · {h.by}{h.notified ? " · WhatsApp sent" : ""}</span>
                  {h.note && <p className="text-ink-700">{h.note}</p>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Modal>

      <Modal
        open={!!add}
        onClose={() => setAdd(null)}
        title="New ticket for a client"
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setAdd(null)}>
              Cancel
            </Btn>
            <Btn
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const t = await api("/co/clients-tickets", { body: add });
                  toast("ok", `Ticket ${t.ticketNo} created`);
                  setAdd(null);
                  load();
                } catch (e: any) {
                  toast("err", e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create
            </Btn>
          </>
        }
      >
        {add && (
          <div className="grid gap-4">
            <Field label="Client" required>
              <ClientSelect value={add.clientId} onChange={(v) => setAdd({ ...add, clientId: v })} />
            </Field>
            <Field label="Support category" required>
              <select className="input" value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })}>
                {SUPPORT_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Support needed" required>
              <textarea className="input min-h-[110px]" maxLength={4000} value={add.description} onChange={(e) => setAdd({ ...add, description: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Confirm
        open={!!del}
        title={`Delete ${del?.ticketNo}?`}
        body="The ticket and its history are removed. The client is not notified."
        confirmLabel="Delete"
        danger
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await api(`/co/clients-tickets/${del._id}`, { method: "DELETE" });
          toast("ok", "Ticket deleted");
          setDel(null);
          load();
        }}
      />
    </>
  );
}

"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { RotateCw, FileJson, Search } from "lucide-react";
import { api, qs, fmtDate } from "@/lib/api";
import { Badge, Btn, Empty, JsonView, Modal, Pager, Spinner, useToast } from "./ui";
import { usePerm } from "./Shell";

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="date" className="input w-auto" value={from} onChange={(e) => onChange(e.target.value, to)} aria-label="From date" />
      <span className="text-ink-400">–</span>
      <input type="date" className="input w-auto" value={to} onChange={(e) => onChange(from, e.target.value)} aria-label="To date" />
    </div>
  );
}

/* ───────── WhatsApp Logs ───────── */
export function WaLogs({ base }: { base: "/sa" | "/co" }) {
  const [f, setF] = useState({ from: "", to: "", event: "", to_: "", page: 1 });
  const [data, setData] = useState<Page<any> | null>(null);
  const [events, setEvents] = useState<{ key: string; label: string }[]>([]);
  const [view, setView] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const perm = usePerm("wa_logs");
  const toast = useToast();

  const fetchPage = useCallback(() => {
    const p = new URLSearchParams();
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
    if (f.event) p.set("event", f.event);
    if (f.to_) p.set("phone", f.to_);
    p.set("page", String(f.page));
    api<Page<any>>(`${base}/wa-logs?${p}`).then(setData);
  }, [base, f]);
  useEffect(fetchPage, [fetchPage]);
  useEffect(() => {
    api(`${base}/webhooks/events`).then(setEvents).catch(() => {});
  }, [base]);

  async function resend(id: string) {
    setBusy(id);
    try {
      const row = data?.items.find((x: any) => x._id === id);
      const r = await api(`${base}/wa-logs/${id}/resend${row?.companyId ? `?companyId=${row.companyId}` : ""}`, { method: "POST" });
      toast(r.result === "success" ? "ok" : "err", r.result === "success" ? "Resent" : r.detail);
      fetchPage();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }

  const payload = async (l: any) => {
    if (view?._id === l._id) return setView(null); // same row again closes it
    setView({ _id: l._id, loading: true });
    try {
      setView(await api(`${base}/wa-logs/${l._id}${l.companyId ? `?companyId=${l.companyId}` : ""}`));
    } catch (e: any) {
      toast("err", e.message);
      setView(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Btn variant="secondary" onClick={fetchPage}>
          <RotateCw className="h-4 w-4" /> Refresh
        </Btn>
        <p className="text-[13px] text-ink-500">
          Every WhatsApp attempt with the webhook&rsquo;s response. <b className="text-ink-900">Resend</b> posts the stored payload again to that event&rsquo;s current webhook URL.
        </p>
      </div>
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-400/15 px-3 py-2.5">
          <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to, page: 1 })} />
          <select className="input h-9 w-auto min-w-[170px] py-1.5 text-sm" value={f.event} onChange={(e) => setF({ ...f, event: e.target.value, page: 1 })} aria-label="Event">
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input h-9 w-40 py-1.5 pl-9 text-sm" placeholder="To (phone)" inputMode="numeric" value={f.to_} onChange={(e) => setF({ ...f, to_: e.target.value.replace(/\D/g, ""), page: 1 })} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr>
                {["Time", "Event", "Trigger", "To", "Name", "Result", "Detail", "Actions"].map((h) => (
                  <th key={h} className={`th py-2.5 ${h === "Actions" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((l) => {
                const open = view?._id === l._id;
                const retry = l.retry?.status;
                return (
                  <Fragment key={l._id}>
                    <tr className={open ? "bg-hive-50/60" : "hover:bg-hive-50/40"}>
                      <td className="td py-2.5 whitespace-nowrap text-ink-500">{fmtDate(l.createdAt)}</td>
                      <td className="td py-2.5 mono">{l.event}</td>
                      <td className="td py-2.5">{l.trigger}</td>
                      <td className="td py-2.5 mono">{l.to}</td>
                      <td className="td py-2.5">{l.name || "—"}</td>
                      <td className="td py-2.5 whitespace-nowrap">
                        <Badge color={l.result === "success" ? "green" : retry === "scheduled" ? "honey" : "red"}>
                          {l.result === "success" ? `OK ${l.httpStatus || 200}` : retry === "scheduled" ? "Retrying" : retry === "dead" ? "Dead-lettered" : l.httpStatus ? `Failed ${l.httpStatus}` : "Failed"}
                        </Badge>
                        {retry === "delivered" && <span className="ml-1 text-[11px] text-ink-400">on retry</span>}
                        {retry === "scheduled" && l.retry?.nextAt && <span className="mt-0.5 block text-[11px] text-ink-400">next try {new Date(l.retry.nextAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
                        {l.part && <span className="ml-1 text-xs text-ink-400">{l.part}</span>}
                      </td>
                      <td className="td py-2.5 max-w-[320px]">
                        <span className="mono block truncate text-[12.5px] text-ink-500" title={l.responseText || l.detail}>
                          {l.responseText || l.detail || "—"}
                        </span>
                      </td>
                      <td className="td py-2.5 whitespace-nowrap text-right">
                        <button className="btn-ghost" onClick={() => payload(l)} aria-expanded={open}>
                          <FileJson className="h-4 w-4" /> Payload
                        </button>
                        {perm.update && (
                          <button className="btn-ghost" onClick={() => resend(l._id)} disabled={busy === l._id}>
                            {busy === l._id ? <Spinner /> : <RotateCw className="h-4 w-4" />} Resend
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} className="border-b border-ink-400/10 bg-[#f7f8f6] px-3 pb-3 pt-0">
                          {view.loading ? (
                            <div className="flex justify-center py-6 text-hive-700">
                              <Spinner className="h-5 w-5" />
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-xs text-ink-500">
                                {view.request?.method} <span className="mono break-all">{view.request?.url}</span> · HTTP {view.httpStatus} · {view.attempts} attempt(s)
                              </p>
                              <div className="grid gap-3 lg:grid-cols-2">
                                <div>
                                  <p className="label">Request body</p>
                                  <JsonView value={view.request?.body} />
                                </div>
                                <div>
                                  <p className="label">Response</p>
                                  <JsonView value={view.response} />
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!data && (
            <div className="flex justify-center py-16 text-hive-700">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {data && !data.items.length && <Empty title="No WhatsApp messages" hint="Messages sent through webhooks appear here." />}
        </div>
        {data && data.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </div>
    </div>
  );
}

/* ───────── Activity Logs ───────── */
export function ActivityLogs({ base, side, companyFilter }: { base: "/sa" | "/co"; side?: "super" | "company"; companyFilter?: boolean }) {
  const [f, setF] = useState({ from: "", to: "", companyId: "", q: "", page: 1 });
  const [data, setData] = useState<Page<any> | null>(null);
  const [companies, setCompanies] = useState<{ _id: string; name: string }[]>([]);
  const [view, setView] = useState<any>(null);

  useEffect(() => {
    setData(null);
    api<Page<any>>(`${base}/activity-logs${qs({ ...f, side })}`).then(setData);
  }, [base, f, side]);
  useEffect(() => {
    if (companyFilter) api(`/sa/companies-lite`).then(setCompanies);
  }, [companyFilter]);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
        {companyFilter && (
          <select className="input w-auto min-w-[220px]" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value, page: 1 })} aria-label="Company name">
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to, page: 1 })} />
        <input className="input w-56" placeholder="Search user or item" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr>
              {["Time", ...(companyFilter ? ["Company"] : []), "User", "Action", "Module", "Item", "Response", "Error status", "Payload"].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l) => (
              <tr key={l._id} className="hover:bg-hive-50/40">
                <td className="td whitespace-nowrap text-ink-500">{fmtDate(l.createdAt)}</td>
                {companyFilter && <td className="td">{l.companyName || "—"}</td>}
                <td className="td max-w-[220px]">
                  <span className="block truncate" title={l.userLabel}>
                    {l.userLabel}
                  </span>
                  {l.impersonatedBy && <span className="text-xs text-honey-700">via {l.impersonatedBy}</span>}
                </td>
                <td className="td font-semibold">{l.action}</td>
                <td className="td mono">{l.module}</td>
                <td className="td max-w-[200px] truncate" title={l.item}>
                  {l.item || "—"}
                </td>
                <td className="td">
                  <Badge color={l.response < 300 ? "green" : l.response < 500 ? "honey" : "red"}>{l.response}</Badge>
                </td>
                <td className="td max-w-[200px] truncate text-red-700" title={l.error}>
                  {l.error || "—"}
                </td>
                <td className="td">
                  <button className="btn-ghost" onClick={() => setView(l)}>
                    <FileJson className="h-4 w-4" /> View
                  </button>
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
        {data && !data.items.length && <Empty title="No activity in this range" />}
      </div>
      {data && data.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      <Modal open={!!view} onClose={() => setView(null)} title="Payload">
        {view && <JsonView value={{ ...view.payload, ip: view.ip }} />}
      </Modal>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { key: T; label: string }[] }) {
  return (
    <div className="mb-5 inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-ink-400/20 bg-white p-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${value === t.key ? "bg-hive-700 text-white" : "text-ink-700 hover:bg-hive-50"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export { Btn };

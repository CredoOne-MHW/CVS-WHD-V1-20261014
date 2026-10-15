"use client";
import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, CalendarClock, RefreshCw } from "lucide-react";
import { api, qs } from "@/lib/api";
import { Modal, Field, Btn, Badge, Empty, Spinner, Pager, Confirm, useToast } from "./ui";
import { SearchSelect } from "./Select";
import { FREQUENCIES, freqLabel, nextRenewal } from "@shared/billing";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d?: string | Date) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Super Admin › AI Agents › Allocation: which companies get which models, on what renewal cycle. */
export function AllocationTab({ models, open, setOpen, perm }: { models: any[]; open: boolean; setOpen: (v: boolean) => void; perm: any }) {
  const [companies, setCompanies] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<{ companyId: string; agentId: string }>({ companyId: "", agentId: "" });
  const [edit, setEdit] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const toast = useToast();

  const load = () => api(`/sa/ai-allocations${qs({ page, ...filter })}`, { fresh: true }).then(setData).catch((e) => toast("err", e.message));
  useEffect(() => {
    api("/sa/subscriptions/meta").then((m) => setCompanies(m.companies)).catch(() => api("/sa/companies?limit=200").then((r) => setCompanies(r.items || r)));
  }, []);
  useEffect(() => {
    load();
  }, [page, filter.companyId, filter.agentId]);

  const coOpts = useMemo(() => companies.map((c) => ({ value: c._id, label: c.name, hint: c.code })), [companies]);
  const modelOpts = useMemo(() => models.filter((m) => m.active).map((m) => ({ value: m._id, label: m.name, hint: m.llmVersion })), [models]);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <SearchSelect options={[{ value: "", label: "All companies" }, ...coOpts]} value={filter.companyId} onChange={(v) => (setPage(1), setFilter({ ...filter, companyId: v }))} placeholder="All companies" />
        <SearchSelect options={[{ value: "", label: "All models" }, ...models.map((m) => ({ value: m._id, label: m.name, hint: m.llmVersion }))]} value={filter.agentId} onChange={(v) => (setPage(1), setFilter({ ...filter, agentId: v }))} placeholder="All models" />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr>
              {["Company", "Model", "Credits / cycle", "Used", "Left", "Start date", "Renewal", "Renewal date", ""].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((a: any) => {
              const pct = a.credits ? Math.max(0, Math.min(100, (a.remaining / a.credits) * 100)) : 0;
              return (
                <tr key={a._id} className="hover:bg-hive-50/40">
                  <td className="td font-semibold">
                    {a.company?.name || "—"} <span className="text-xs font-normal text-ink-400">{a.company?.code}</span>
                  </td>
                  <td className="td">
                    {a.model?.name || "Removed"} <span className="mono block text-xs text-ink-400">{a.model?.llmVersion}</span>
                  </td>
                  <td className="td tabular-nums">{Number(a.credits).toLocaleString("en-IN")}</td>
                  <td className="td tabular-nums">{Number(a.used).toFixed(2)}</td>
                  <td className="td">
                    <span className={`tabular-nums font-semibold ${pct > 10 ? "text-hive-800" : "text-red-600"}`}>{Number(a.remaining).toLocaleString("en-IN")}</span>
                    <span className="mt-1 block h-1 w-20 overflow-hidden rounded-full bg-ink-400/15">
                      <span className={`block h-full ${pct > 10 ? "bg-hive-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
                    </span>
                  </td>
                  <td className="td whitespace-nowrap">{fmt(a.startDate)}</td>
                  <td className="td">
                    <Badge color="blue">{freqLabel(a.frequency)}</Badge>
                  </td>
                  <td className="td whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 text-hive-600" /> {fmt(a.renewalDate)}
                    </span>
                  </td>
                  <td className="td whitespace-nowrap text-right">
                    {perm.update && (
                      <button className="btn-ghost" aria-label="Edit allocation" onClick={() => setEdit({ ...a, startDate: String(a.startDate || "").slice(0, 10), resetUsed: false })}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {perm.delete && (
                      <button className="btn-ghost text-red-600" aria-label="Remove allocation" onClick={() => setDel(a)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
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
        {data && !data.items.length && <Empty title="No allocations yet" hint="Use Allocate to give companies access to AI models. Only allocated models appear on the company's AI Agent screen." />}
        {data && data.total > data.limit && (
          <div className="border-t border-ink-400/10 px-4 py-2">
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </div>
        )}
      </div>

      <AllocateModal open={open} onClose={() => setOpen(false)} coOpts={coOpts} modelOpts={modelOpts} models={models} onDone={() => (setPage(1), load())} />

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Edit allocation · ${edit?.company?.name || ""}`}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Btn>
            <Btn
              onClick={async () => {
                try {
                  await api(`/sa/ai-allocations/${edit._id}`, { method: "PUT", body: { credits: Number(edit.credits), startDate: edit.startDate, frequency: edit.frequency, resetUsed: edit.resetUsed } });
                  toast("ok", "Allocation updated");
                  setEdit(null);
                  load();
                } catch (e: any) {
                  toast("err", e.message);
                }
              }}
            >
              Save
            </Btn>
          </>
        }
      >
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Credits per cycle">
              <input type="number" min={0} className="input" value={edit.credits} onChange={(e) => setEdit({ ...edit, credits: e.target.value })} />
            </Field>
            <Field label="Allocation start date">
              <input type="date" className="input" value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
            </Field>
            <Field label="Renewal frequency">
              <select className="input" value={edit.frequency} onChange={(e) => setEdit({ ...edit, frequency: e.target.value })}>
                {FREQUENCIES.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Renewal date">
              <input className="input bg-[#f7f8f6]" readOnly value={edit.startDate ? fmt(nextRenewal(edit.startDate, edit.frequency)) : "—"} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={edit.resetUsed} onChange={(e) => setEdit({ ...edit, resetUsed: e.target.checked })} /> Reset used credits to 0 now
            </label>
          </div>
        )}
      </Modal>
      <Confirm
        open={!!del}
        title="Remove this allocation?"
        body={`${del?.model?.name} will no longer be available to ${del?.company?.name}. Usage history is kept.`}
        confirmLabel="Remove"
        danger
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await api(`/sa/ai-allocations/${del._id}`, { method: "DELETE" });
          toast("ok", "Allocation removed");
          load();
        }}
      />
    </>
  );
}

function AllocateModal({ open, onClose, coOpts, modelOpts, models, onDone }: { open: boolean; onClose: () => void; coOpts: any[]; modelOpts: any[]; models: any[]; onDone: () => void }) {
  const blank = { companyIds: [] as string[], agentIds: [] as string[], startDate: today(), frequency: "monthly", credits: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) setF(blank);
  }, [open]);
  const renewal = f.startDate ? nextRenewal(f.startDate, f.frequency) : null;
  const defaults = models.filter((m) => f.agentIds.includes(m._id));

  async function save() {
    setBusy(true);
    try {
      const r = await api("/sa/ai-allocations", { body: { ...f, credits: f.credits === "" ? undefined : Number(f.credits) } });
      toast("ok", `Allocated · ${r.allocated} pairing(s)`);
      onClose();
      onDone();
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
      title="Allocate AI models"
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn loading={busy} disabled={!f.companyIds.length || !f.agentIds.length || !f.startDate} onClick={save}>
            Allocate {f.companyIds.length && f.agentIds.length ? `(${f.companyIds.length} × ${f.agentIds.length})` : ""}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" required className="sm:col-span-2">
          <SearchSelect multiple options={coOpts} value={f.companyIds} onChange={(v) => setF({ ...f, companyIds: v })} placeholder="Search and select companies…" />
        </Field>
        <Field label="Models" required className="sm:col-span-2">
          <SearchSelect multiple options={modelOpts} value={f.agentIds} onChange={(v) => setF({ ...f, agentIds: v })} placeholder="Search and select models…" />
        </Field>
        <Field label="Allocation start date" required>
          <input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <Field label="Allocation renewal frequency" required>
          <select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            {FREQUENCIES.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Renewal date" hint="Calculated automatically from the start date and frequency.">
          <div className="input flex items-center gap-2 bg-hive-50/60 font-semibold text-hive-800">
            <RefreshCw className="h-4 w-4" /> {renewal ? fmt(renewal) : "—"}
          </div>
        </Field>
        <Field label="Credits per cycle" hint={defaults.length ? `Leave blank to use each model's default (${defaults.map((m) => `${m.name}: ${m.credits}`).join(", ")}).` : "Leave blank to use each model's default credits."}>
          <input type="number" min={0} className="input" placeholder="Model default" value={f.credits} onChange={(e) => setF({ ...f, credits: e.target.value })} />
        </Field>
      </div>
      <p className="mt-4 rounded-xl bg-[#f7f8f6] px-3 py-2 text-xs text-ink-500">
        On each renewal date the company's used credits reset and the next renewal date is set automatically. Re-allocating an existing pair updates it.
      </p>
    </Modal>
  );
}

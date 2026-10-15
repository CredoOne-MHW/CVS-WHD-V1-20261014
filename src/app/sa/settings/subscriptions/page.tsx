"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, BarChart3, BellRing, Search, X, Wallet, AlertTriangle, CheckCircle2, Clock3, Ban, CalendarRange } from "lucide-react";
import { api, qs } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Empty, Spinner, Pager, Confirm, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";
import { Tabs } from "@/components/Logs";
import { SearchSelect } from "@/components/Select";
import { FREQUENCIES, REMINDER_DAYS, PAYMENT_STATUSES, freqLabel, addPeriod, discountOf } from "@shared/billing";

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmt = (d?: string | Date) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const today = () => new Date().toISOString().slice(0, 10);
const STATUS_STYLE: Record<string, string> = {
  paid: "bg-hive-100 text-hive-800 ring-hive-200",
  unpaid: "bg-amber-50 text-amber-800 ring-amber-200",
  overdue: "bg-red-50 text-red-700 ring-red-200",
  expired: "bg-ink-400/10 text-ink-700 ring-ink-400/30",
};

export default function SubscriptionManagement() {
  const perm = usePerm("subscriptions");
  const [tab, setTab] = useState<"plan" | "allocation" | "status">("plan");
  const [meta, setMeta] = useState<{ plans: string[]; companies: any[]; webhooks: any[] }>({ plans: [], companies: [], webhooks: [] });
  const [summary, setSummary] = useState<any>(null);
  const [plans, setPlans] = useState<any[] | null>(null);
  const [planForm, setPlanForm] = useState<any>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const toast = useToast();

  const loadPlans = () => api("/sa/subscriptions/plans", { fresh: true }).then(setPlans);
  const loadSummary = () => api("/sa/subscriptions/summary", { fresh: true }).then(setSummary).catch(() => undefined);
  useEffect(() => {
    api("/sa/subscriptions/meta").then(setMeta).catch((e) => toast("err", e.message));
    loadPlans();
    loadSummary();
  }, []);

  return (
    <>
      <PageHeader
        title="Subscription Management"
        subtitle="Subscription plans, which company is on which plan, and payment status of every billing cycle"
        actions={
          perm.create && tab !== "status" ? (
            tab === "plan" ? (
              <Btn onClick={() => setPlanForm({ planName: "", amount: "", frequency: "monthly", reminderDays: [7, 3, 1], notifyWebApp: true, notifyWhatsApp: true, webhookId: "", active: true })}>
                <Plus className="h-4 w-4" /> Create
              </Btn>
            ) : (
              <Btn onClick={() => setAllocOpen(true)} disabled={!plans?.length}>
                <Plus className="h-4 w-4" /> Allocate
              </Btn>
            )
          ) : null
        }
      />

      <SummaryStrip s={summary} />

      <Tabs value={tab} onChange={setTab} tabs={[{ key: "plan", label: "Plan" }, { key: "allocation", label: "Allocation" }, { key: "status", label: "Status" }]} />

      {tab === "plan" && <PlanTab plans={plans} perm={perm} onEdit={setPlanForm} reload={loadPlans} />}
      {tab === "allocation" && <AllocationTab meta={meta} plans={plans || []} perm={perm} open={allocOpen} setOpen={setAllocOpen} onChange={loadSummary} />}
      {tab === "status" && <StatusTab meta={meta} perm={perm} onChange={loadSummary} />}

      <PlanModal form={planForm} setForm={setPlanForm} meta={meta} onSaved={() => (loadPlans(), loadSummary())} />
    </>
  );
}

function SummaryStrip({ s }: { s: any }) {
  const tiles = [
    { k: "unpaid", label: "Unpaid", icon: Clock3, tone: "text-amber-700 bg-amber-50" },
    { k: "overdue", label: "Over Due", icon: AlertTriangle, tone: "text-red-700 bg-red-50" },
    { k: "paid", label: "Paid", icon: CheckCircle2, tone: "text-hive-800 bg-hive-50" },
    { k: "expired", label: "Expired", icon: Ban, tone: "text-ink-700 bg-ink-400/10" },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.k} className="card flex items-center gap-3 p-4">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${t.tone}`}>
            <t.icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t.label} cycles</p>
            <p className="text-lg font-extrabold text-ink-900">
              {s ? s[t.k].n : "—"} <span className="text-sm font-semibold text-ink-500">{s ? inr(s[t.k].amount) : ""}</span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────── Plan tab ───────────── */
function PlanTab({ plans, perm, onEdit, reload }: { plans: any[] | null; perm: any; onEdit: (p: any) => void; reload: () => void }) {
  const [del, setDel] = useState<any>(null);
  const toast = useToast();
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[900px]">
        <thead>
          <tr>
            {["Plan", "Subscription amount", "Frequency", "Reminder notification", "Notify via", "Companies", "Status", ""].map((h) => (
              <th key={h} className="th">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plans?.map((p) => (
            <tr key={p._id} className="hover:bg-hive-50/40">
              <td className="td font-semibold">{p.planName}</td>
              <td className="td tabular-nums font-semibold">{inr(p.amount)}</td>
              <td className="td">
                <Badge color="blue">{freqLabel(p.frequency)}</Badge>
              </td>
              <td className="td">
                <div className="flex flex-wrap gap-1">
                  {[...(p.reminderDays || [])].sort((a: number, b: number) => b - a).map((d: number) => (
                    <Badge key={d} color="honey">
                      {d} day{d > 1 ? "s" : ""} prior
                    </Badge>
                  ))}
                  {!p.reminderDays?.length && <span className="text-ink-400">None</span>}
                </div>
              </td>
              <td className="td text-sm">
                {[p.notifyWebApp && "Web app", p.notifyWhatsApp && "WhatsApp"].filter(Boolean).join(" · ") || "—"}
                {p.notifyWhatsApp && <span className="block text-xs text-ink-400">{p.webhookName ? `via ${p.webhookName}` : "via event webhooks"}</span>}
              </td>
              <td className="td tabular-nums">{p.companies}</td>
              <td className="td">
                <Badge color={p.active ? "green" : "gray"}>{p.active ? "Active" : "Off"}</Badge>
              </td>
              <td className="td whitespace-nowrap text-right">
                {perm.update && (
                  <button className="btn-ghost" aria-label="Edit plan" onClick={() => onEdit({ ...p, webhookId: p.webhookId || "" })}>
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                {perm.delete && (
                  <button className="btn-ghost text-red-600" aria-label="Delete plan" onClick={() => setDel(p)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!plans && (
        <div className="flex justify-center py-16 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      )}
      {plans && !plans.length && <Empty title="No subscription plans yet" hint="Create a plan — pick a Plan from the Plan module, set its price, frequency and reminders." />}
      <Confirm
        open={!!del}
        title="Delete this subscription plan?"
        body={`${del?.planName} · ${freqLabel(del?.frequency)} will be removed.`}
        confirmLabel="Delete"
        danger
        onClose={() => setDel(null)}
        onConfirm={async () => {
          try {
            await api(`/sa/subscriptions/plans/${del._id}`, { method: "DELETE" });
            toast("ok", "Plan deleted");
            reload();
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </div>
  );
}

function PlanModal({ form, setForm, meta, onSaved }: { form: any; setForm: (v: any) => void; meta: any; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const hookOpts = useMemo(() => [{ value: "", label: "Any webhook on event “Subscription payment reminder”" }, ...meta.webhooks.map((w: any) => ({ value: w._id, label: w.name, hint: w.event }))], [meta.webhooks]);
  if (!form) return null;
  async function save() {
    setBusy(true);
    try {
      const body = { ...form, amount: Number(form.amount), webhookId: form.webhookId || null };
      for (const k of ["_id", "createdAt", "updatedAt", "__v", "companies", "webhookName"]) delete body[k];
      if (form._id) await api(`/sa/subscriptions/plans/${form._id}`, { method: "PUT", body });
      else await api("/sa/subscriptions/plans", { body });
      toast("ok", "Subscription plan saved");
      setForm(null);
      onSaved();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => setForm(null)}
      title={form._id ? "Edit subscription plan" : "Create subscription plan"}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={() => setForm(null)}>
            Cancel
          </Btn>
          <Btn loading={busy} disabled={!form.planName || form.amount === ""} onClick={save}>
            Save
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan" required hint="From the Plan module">
          <SearchSelect options={meta.plans.map((p: string) => ({ value: p, label: p }))} value={form.planName} onChange={(v) => setForm({ ...form, planName: v })} placeholder="Search plan…" />
        </Field>
        <Field label="Subscription amount (₹)" required>
          <input type="number" min={0} step="0.01" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 4999" />
        </Field>
        <Field label="Frequency" required>
          <select className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
            {FREQUENCIES.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reminder notification">
          <SearchSelect multiple options={REMINDER_DAYS.map((d) => ({ value: String(d.key), label: d.label }))} value={(form.reminderDays || []).map(String)} onChange={(v: string[]) => setForm({ ...form, reminderDays: v.map(Number) })} placeholder="When to remind…" />
        </Field>
        <div className="sm:col-span-2">
          <p className="label">Notify to</p>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 rounded-xl border border-ink-400/20 px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={!!form.notifyWebApp} onChange={(e) => setForm({ ...form, notifyWebApp: e.target.checked })} /> Company web app (banner)
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-ink-400/20 px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={!!form.notifyWhatsApp} onChange={(e) => setForm({ ...form, notifyWhatsApp: e.target.checked })} /> WhatsApp
            </label>
          </div>
        </div>
        {form.notifyWhatsApp && (
          <Field label="WhatsApp webhook" className="sm:col-span-2" hint="Pick a webhook from Settings › WhatsApp Webhook, or leave the default to use webhooks created for the subscription events.">
            <SearchSelect options={hookOpts} value={form.webhookId || ""} onChange={(v) => setForm({ ...form, webhookId: v })} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (can be allocated)
        </label>
      </div>
    </Modal>
  );
}

/* ───────────── Allocation tab ───────────── */
function AllocationTab({ meta, plans, perm, open, setOpen, onChange }: { meta: any; plans: any[]; perm: any; open: boolean; setOpen: (v: boolean) => void; onChange: () => void }) {
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(null);
  const [end, setEnd] = useState<any>(null);
  const toast = useToast();
  const load = () => api(`/sa/subscriptions/allocations${qs({ page })}`, { fresh: true }).then(setData).catch((e) => toast("err", e.message));
  useEffect(() => {
    load();
  }, [page]);

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead>
            <tr>
              {["Company", "Subscription plan", "Amount", "Discount applied", "Net / cycle", "Start date", "Next due", "Current cycle", ""].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s: any) => (
              <tr key={s._id} className="hover:bg-hive-50/40">
                <td className="td font-semibold">
                  {s.company?.name} <span className="text-xs font-normal text-ink-400">{s.company?.code}</span>
                </td>
                <td className="td">
                  {s.planName} <span className="block text-xs text-ink-400">{freqLabel(s.frequency)}</span>
                </td>
                <td className="td tabular-nums">{inr(s.amount)}</td>
                <td className="td tabular-nums">
                  {s.discount ? inr(s.discount) : "—"}
                  {s.discountType === "percent" && s.discountValue ? <span className="block text-xs text-ink-400">{s.discountValue}%</span> : null}
                </td>
                <td className="td tabular-nums font-semibold">{inr(s.amount - s.discount)}</td>
                <td className="td whitespace-nowrap">{fmt(s.startDate)}</td>
                <td className="td whitespace-nowrap">{fmt(s.nextDue)}</td>
                <td className="td">{s.currentStatus ? <StatusPill status={s.currentStatus} /> : "—"}</td>
                <td className="td whitespace-nowrap text-right">
                  {perm.update && (
                    <button className="btn-ghost" aria-label="Edit discount" onClick={() => setEdit({ _id: s._id, name: s.company?.name, amount: s.amount, discountType: s.discountType, discountValue: s.discountValue })}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {perm.delete && (
                    <button className="btn-ghost text-red-600" aria-label="End subscription" onClick={() => setEnd(s)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
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
        {data && !data.items.length && <Empty title="No companies allocated" hint="Use Allocate to put a company on a subscription plan. Billing cycles are created automatically." />}
        {data && data.total > data.limit && (
          <div className="border-t border-ink-400/10 px-4 py-2">
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </div>
        )}
      </div>

      <AllocateSubModal open={open} onClose={() => setOpen(false)} meta={meta} plans={plans.filter((p) => p.active)} onDone={() => (setPage(1), load(), onChange())} />

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Discount · ${edit?.name || ""}`}
        size="sm"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Btn>
            <Btn
              onClick={async () => {
                try {
                  await api(`/sa/subscriptions/allocations/${edit._id}`, { method: "PUT", body: { discountType: edit.discountType, discountValue: Number(edit.discountValue) } });
                  toast("ok", "Discount updated on unpaid cycles");
                  setEdit(null);
                  load();
                  onChange();
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
        {edit && <DiscountInput value={edit} onChange={(v) => setEdit({ ...edit, ...v })} amount={edit.amount} />}
      </Modal>
      <Confirm
        open={!!end}
        title="End this subscription?"
        body={`${end?.company?.name} will stop getting new billing cycles. Past cycles and payment status stay in Status and History.`}
        confirmLabel="End subscription"
        danger
        onClose={() => setEnd(null)}
        onConfirm={async () => {
          await api(`/sa/subscriptions/allocations/${end._id}`, { method: "DELETE" });
          toast("ok", "Subscription ended");
          load();
          onChange();
        }}
      />
    </>
  );
}

function DiscountInput({ value, onChange, amount }: { value: any; onChange: (v: any) => void; amount: number }) {
  const d = discountOf(amount || 0, value.discountType, Number(value.discountValue) || 0);
  return (
    <div>
      <p className="label">Discount applied</p>
      <div className="flex gap-2">
        <div className="inline-flex rounded-xl border border-ink-400/20 bg-white p-1">
          {[
            ["flat", "₹"],
            ["percent", "%"],
          ].map(([k, l]) => (
            <button key={k} type="button" onClick={() => onChange({ discountType: k })} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${value.discountType === k ? "bg-hive-700 text-white" : "text-ink-700"}`}>
              {l}
            </button>
          ))}
        </div>
        <input type="number" min={0} max={value.discountType === "percent" ? 100 : undefined} className="input" value={value.discountValue} onChange={(e) => onChange({ discountValue: e.target.value })} />
      </div>
      {amount ? (
        <p className="mt-1.5 text-xs text-ink-500">
          {inr(amount)} − {inr(d)} = <b className="text-ink-900">{inr(amount - d)}</b> per cycle (+ AI agent usage)
        </p>
      ) : null}
    </div>
  );
}

function AllocateSubModal({ open, onClose, meta, plans, onDone }: { open: boolean; onClose: () => void; meta: any; plans: any[]; onDone: () => void }) {
  const blank = { companyId: "", subscriptionPlanId: "", startDate: today(), discountType: "flat", discountValue: 0 };
  const [f, setF] = useState<any>(blank);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) setF(blank);
  }, [open]);
  const plan = plans.find((p) => p._id === f.subscriptionPlanId);
  async function save() {
    setBusy(true);
    try {
      await api("/sa/subscriptions/allocations", { body: { ...f, discountValue: Number(f.discountValue) || 0 } });
      toast("ok", "Subscription allocated — first billing cycle created");
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
      title="Allocate subscription"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn loading={busy} disabled={!f.companyId || !f.subscriptionPlanId} onClick={save}>
            Allocate
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Company" required>
          <SearchSelect options={meta.companies.map((c: any) => ({ value: c._id, label: c.name, hint: c.code }))} value={f.companyId} onChange={(v) => setF({ ...f, companyId: v })} placeholder="Search company…" />
        </Field>
        <Field label="Subscription plan" required>
          <SearchSelect options={plans.map((p) => ({ value: p._id, label: `${p.planName} · ${freqLabel(p.frequency)}`, hint: inr(p.amount) }))} value={f.subscriptionPlanId} onChange={(v) => setF({ ...f, subscriptionPlanId: v })} placeholder="Search plan…" />
        </Field>
        <Field label="Start date" required>
          <input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <DiscountInput value={f} onChange={(v) => setF({ ...f, ...v })} amount={plan?.amount || 0} />
        {plan && f.startDate && (
          <div className="flex items-center gap-2 rounded-xl bg-hive-50/70 px-3 py-2.5 text-sm text-hive-900">
            <CalendarRange className="h-4 w-4" /> First cycle {fmt(f.startDate)} → due <b>{fmt(addPeriod(f.startDate, plan.frequency))}</b>, then every {freqLabel(plan.frequency).toLowerCase()}.
          </div>
        )}
        <p className="text-xs text-ink-500">If the company already has an active subscription, it ends and this one takes over (history is kept).</p>
      </div>
    </Modal>
  );
}

/* ───────────── Status tab ───────────── */
function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${STATUS_STYLE[status] || STATUS_STYLE.unpaid}`}>{PAYMENT_STATUSES.find((s) => s.key === status)?.label || status}</span>;
}

function StatusTab({ meta, perm, onChange }: { meta: any; perm: any; onChange: () => void }) {
  const [sub, setSub] = useState<"active" | "overdue" | "expired">("active");
  const [filters, setFilters] = useState({ from: "", to: "", company: "" });
  const [companyInput, setCompanyInput] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [remind, setRemind] = useState<any>(null);
  const toast = useToast();

  // debounce the company search so typing doesn't fire a request per key
  useEffect(() => {
    const t = setTimeout(() => (setPage(1), setFilters((f) => ({ ...f, company: companyInput }))), 350);
    return () => clearTimeout(t);
  }, [companyInput]);
  const load = () =>
    api(`/sa/subscriptions/cycles${qs({ tab: sub, page, ...filters })}`, { fresh: true })
      .then(setData)
      .catch((e) => toast("err", e.message));
  useEffect(() => {
    setData(null);
    load();
  }, [sub, page, filters.from, filters.to, filters.company]);

  async function setStatus(row: any, status: string) {
    try {
      await api(`/sa/subscriptions/cycles/${row._id}/status`, { method: "PUT", body: { status } });
      toast("ok", `Marked ${PAYMENT_STATUSES.find((s) => s.key === status)?.label}`);
      load();
      onChange();
    } catch (e: any) {
      toast("err", e.message);
    }
  }
  const c = data?.counts;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["active", "Active", c?.active],
            ["overdue", "Over Dues", c?.overdue],
            ["expired", "Expired", c?.expired],
          ] as const
        ).map(([k, l, n]) => (
          <button
            key={k}
            onClick={() => (setPage(1), setSub(k))}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ring-1 transition ${sub === k ? (k === "overdue" ? "bg-red-600 text-white ring-red-600" : "bg-hive-700 text-white ring-hive-700") : "bg-white text-ink-700 ring-ink-400/20 hover:bg-hive-50"}`}
          >
            {l} {n != null && <span className={`rounded-full px-1.5 text-xs ${sub === k ? "bg-white/20" : "bg-ink-400/10"}`}>{n}</span>}
          </button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 rounded-2xl border border-ink-400/12 bg-white p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
        <Field label="Expiry from">
          <input type="date" className="input" value={filters.from} onChange={(e) => (setPage(1), setFilters({ ...filters, from: e.target.value }))} />
        </Field>
        <Field label="Expiry to">
          <input type="date" className="input" value={filters.to} onChange={(e) => (setPage(1), setFilters({ ...filters, to: e.target.value }))} />
        </Field>
        <Field label="Company name">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" placeholder="Search company…" value={companyInput} onChange={(e) => setCompanyInput(e.target.value)} />
          </div>
        </Field>
        <Btn variant="ghost" onClick={() => (setCompanyInput(""), setFilters({ from: "", to: "", company: "" }))}>
          <X className="h-4 w-4" /> Clear
        </Btn>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1150px]">
          <thead>
            <tr>
              {["Company name", "Start date", "Expiry date", "Total amount", "System due", "AI agent due", "Discount applied", "Payment status", "Action"].map((h) => (
                <th key={h} className={`th ${["Total amount", "System due", "AI agent due", "Discount applied"].includes(h) ? "text-right" : ""} ${h === "Action" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r: any) => (
              <tr key={r._id} className="hover:bg-hive-50/40">
                <td className="td">
                  <span className="font-semibold">{r.company?.name || "—"}</span>
                  <span className="block text-xs text-ink-400">
                    {r.planName} · {freqLabel(r.frequency)}
                  </span>
                </td>
                <td className="td whitespace-nowrap">{fmt(r.periodStart)}</td>
                <td className="td whitespace-nowrap">
                  {fmt(r.periodEnd)}
                  <span className={`block text-xs ${r.daysLeft < 0 ? "text-red-600" : r.daysLeft <= 7 ? "text-amber-700" : "text-ink-400"}`}>
                    {r.daysLeft < 0 ? `${-r.daysLeft} day(s) late` : r.daysLeft === 0 ? "due today" : `in ${r.daysLeft} day(s)`}
                  </span>
                </td>
                <td className="td text-right tabular-nums font-bold">{inr(r.total)}</td>
                <td className="td text-right tabular-nums">{inr(r.systemAmount)}</td>
                <td className="td text-right tabular-nums">
                  {inr(r.aiAmount)}
                  {r.aiLive && <span className="block text-[10.5px] text-ink-400">so far</span>}
                </td>
                <td className="td text-right tabular-nums">{r.discount ? `− ${inr(r.discount)}` : "—"}</td>
                <td className="td">
                  {perm.update ? (
                    <select aria-label="Payment status" value={r.status} onChange={(e) => setStatus(r, e.target.value)} className={`rounded-full border-0 py-1 pl-3 pr-8 text-xs font-bold ring-1 focus:ring-2 ${STATUS_STYLE[r.status]}`}>
                      {PAYMENT_STATUSES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <StatusPill status={r.status} />
                  )}
                </td>
                <td className="td whitespace-nowrap text-right">
                  <button className="btn-ghost" onClick={() => setUsage(r)}>
                    <BarChart3 className="h-4 w-4" /> Usage
                  </button>
                  {perm.update && (
                    <button className="btn-ghost" onClick={() => setRemind(r)} disabled={!r.company?.hasWhatsApp} title={r.company?.hasWhatsApp ? "Send a WhatsApp reminder" : "Company has no WhatsApp number"}>
                      <BellRing className="h-4 w-4" /> Reminder
                    </button>
                  )}
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
        {data && !data.items.length && <Empty title={sub === "active" ? "No active cycles" : sub === "overdue" ? "Nothing over due" : "Nothing expired"} hint="Cycles appear here once a company is allocated a subscription plan." />}
        {data && data.total > data.limit && (
          <div className="border-t border-ink-400/10 px-4 py-2">
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-500">Unpaid cycles become Over Due after the expiry date and Expired 30 days after it. A daily job at 2:00 AM IST updates statuses, renews cycles and sends reminders.</p>

      <UsageModal row={usage} onClose={() => setUsage(null)} />
      <ReminderModal row={remind} onClose={() => setRemind(null)} webhooks={meta.webhooks} />
    </>
  );
}

function UsageModal({ row, onClose }: { row: any; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    setD(null);
    if (row) api(`/sa/subscriptions/cycles/${row._id}/usage`, { fresh: true }).then(setD).catch(() => setD({ error: true }));
  }, [row]);
  const peak = Math.max(0.0001, ...(d?.daily || []).map((x: any) => x.billed));
  return (
    <Modal open={!!row} onClose={onClose} size="xl" title={`Usage · ${row?.company?.name || ""}`}>
      {!d && (
        <div className="flex justify-center py-16 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      )}
      {d && !d.error && (
        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-hive-800 via-hive-900 to-hive-950 p-5 text-white">
            <div aria-hidden className="absolute -right-14 -top-14 h-48 w-48 rounded-full bg-white/5" />
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
              {d.cycle.planName} · {freqLabel(d.cycle.frequency)} · {fmt(d.cycle.periodStart)} → {fmt(d.cycle.periodEnd)}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Total", d.cycle.total],
                ["System due", d.cycle.systemAmount],
                ["AI agent due", d.cycle.aiAmount],
                ["Discount", -d.cycle.discount],
              ].map(([l, v]: any) => (
                <div key={l}>
                  <p className="text-[11px] text-white/60">{l}</p>
                  <p className="text-xl font-extrabold">{v < 0 ? `− ${inr(-v)}` : inr(v)}</p>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <StatusPill status={d.cycle.status} />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <div className="rounded-2xl border border-ink-400/12 bg-white p-4">
              <p className="mb-3 text-sm font-bold">AI agent spend by model</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
                    <th className="pb-2">Model</th>
                    <th className="pb-2 text-right">Calls</th>
                    <th className="pb-2 text-right">Credits</th>
                    <th className="pb-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byModel.map((m: any) => (
                    <tr key={m.model} className="border-t border-ink-400/10">
                      <td className="py-2">
                        {m.model} <span className="mono block text-[11px] text-ink-400">{m.llmVersion}</span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{m.calls}</td>
                      <td className="py-2 text-right tabular-nums">{m.credits}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">{inr(m.billed)}</td>
                    </tr>
                  ))}
                  {!d.byModel.length && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-ink-400">
                        No AI usage in this cycle
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {d.daily.length > 0 && (
                <div className="mt-4 flex h-20 items-end gap-[3px]" role="img" aria-label="AI spend per day">
                  {d.daily.map((x: any) => (
                    <div key={x.day} title={`${x.day}: ${inr(x.billed)}`} className="flex-1 rounded-t bg-hive-500" style={{ height: `${Math.max(6, (x.billed / peak) * 100)}%` }} />
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-ink-400/12 bg-white p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Wallet className="h-4 w-4 text-hive-700" /> AI model allocations
              </p>
              <ul className="space-y-3">
                {d.allocations.map((a: any) => (
                  <li key={a.model}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{a.model}</span>
                      <span className="tabular-nums">
                        {a.remaining} / {a.credits}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-400/15">
                      <span className="block h-full bg-hive-500" style={{ width: `${a.credits ? Math.max(0, Math.min(100, (a.remaining / a.credits) * 100)) : 0}%` }} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {freqLabel(a.frequency)} · renews {fmt(a.renewalDate)}
                    </p>
                  </li>
                ))}
                {!d.allocations.length && <li className="text-sm text-ink-400">No AI models allocated</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
      {d?.error && <p className="text-sm text-red-600">Could not load usage.</p>}
    </Modal>
  );
}

function ReminderModal({ row, onClose, webhooks }: { row: any; onClose: () => void; webhooks: any[] }) {
  const [webhookId, setWebhookId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!row) return;
    setWebhookId("");
    const due = fmt(row.periodEnd);
    setMessage(
      row.status === "expired"
        ? `Hi, your ${row.planName} subscription has expired (payment of ${inr(row.total)} due ${due} not received). Please contact us to renew.`
        : row.status === "overdue"
          ? `Hi, your ${row.planName} subscription payment of ${inr(row.total)} was due on ${due} and is now over due. Please pay at the earliest.`
          : `Hi, your ${row.planName} subscription payment of ${inr(row.total)} is due on ${due}. Please pay to continue uninterrupted service.`
    );
  }, [row]);
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={`WhatsApp reminder · ${row?.company?.name || ""}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api(`/sa/subscriptions/cycles/${row._id}/reminder`, { body: { webhookId: webhookId || null, message } });
                r.sent ? toast("ok", `Reminder sent (${r.sent})`) : toast("err", r.reason || "No webhook delivered — check WhatsApp Logs");
                if (r.sent) onClose();
              } catch (e: any) {
                toast("err", e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <BellRing className="h-4 w-4" /> Send
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="WhatsApp webhook" hint="From Settings › WhatsApp Webhook. Default sends through every webhook on the matching subscription event.">
          <SearchSelect options={[{ value: "", label: "Default (subscription event webhooks)" }, ...webhooks.map((w) => ({ value: w._id, label: w.name, hint: w.event }))]} value={webhookId} onChange={setWebhookId} />
        </Field>
        <Field label="Message">
          <textarea rows={4} className="input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}

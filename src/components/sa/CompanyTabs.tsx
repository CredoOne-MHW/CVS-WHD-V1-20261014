"use client";
import { useEffect, useState } from "react";
import { Users, Building2, KeyRound, CreditCard, Globe2, Copy, ExternalLink, Smartphone, TrendingUp, UserCheck, LifeBuoy, Plug, AlertTriangle, IndianRupee, RotateCcw, Eye, EyeOff, Sparkles } from "lucide-react";
import { api, fmtDate, inr } from "@/lib/api";
import { Field, Btn, Badge, Spinner, Stat, Empty, useToast } from "@/components/ui";
import { BUSINESS_TYPES, STATES } from "@shared/platform";
import { permRows, type ModuleDef } from "@shared/constants";

/* ───────────────────────── Overview ───────────────────────── */

const Copyable = ({ value }: { value: string }) => {
  const toast = useToast();
  return (
    <button
      type="button"
      className="group inline-flex max-w-full items-center gap-2 rounded-lg bg-ink-400/5 px-2.5 py-1.5 font-mono text-xs text-ink-700 hover:bg-hive-50"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => toast("ok", "Copied"), () => toast("err", "Could not copy"));
      }}
      title="Copy"
    >
      <span className="truncate">{value.replace(/^https?:\/\//, "")}</span>
      <Copy className="h-3.5 w-3.5 shrink-0 text-ink-400 group-hover:text-hive-700" />
    </button>
  );
};

export function OverviewTab({ id, company }: { id: string; company: any }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    setD(null);
    api(`/sa/companies/${id}/overview`).then(setD).catch(() => setD({ error: true }));
  }, [id]);
  if (!d)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  if (d.error) return <Empty title="Could not load the overview" hint="Try again in a moment." />;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Leads · 7 days" value={d.leads7} hint={`${d.leadsTotal} in all`} />
        <Stat label="Converted · 7 days" value={d.won7} hint={`${d.clients} client(s)`} tone="honey" />
        <Stat label="Outstanding" value={inr(d.outstanding)} hint={d.upcoming ? `${inr(d.upcoming)} upcoming` : "nothing upcoming"} tone={d.outstanding ? "red" : "gray"} />
        <Stat label="Users" value={d.userCount} hint={d.aiCredits ? `${d.aiCredits} AI credit(s)` : "no AI credits"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <Plug className="h-4 w-4 text-hive-700" /> Channels & deliveries
          </h3>
          <dl className="divide-y divide-ink-400/10 text-sm">
            {[
              ["Connectors", `${d.liveConnectors} live of ${d.connectors}`],
              ["Deliveries needing attention", d.stuck ? `${d.stuck} — Integration › Needs attention` : "none"],
              ["Open support tickets", String(d.openTickets)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2">
                <dt className="text-ink-500">{k}</dt>
                <dd className={`font-semibold ${k === "Deliveries needing attention" && d.stuck ? "text-red-600" : ""}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <Globe2 className="h-4 w-4 text-hive-700" /> Addresses
          </h3>
          <div className="space-y-3 text-sm">
            <div>
              <p className="label mb-1">Platform address</p>
              {d.platformUrl ? <Copyable value={d.platformUrl} /> : <span className="text-ink-400">—</span>}
            </div>
            <div>
              <p className="label mb-1">Company’s own domain</p>
              {d.customUrl ? <Copyable value={d.customUrl} /> : <span className="text-ink-500">No own domain. Add one under Branding &amp; domain.</span>}
            </div>
            <div>
              <p className="label mb-1">Support page</p>
              {d.platformUrl ? <Copyable value={`${d.customUrl || d.platformUrl}/support`} /> : <span className="text-ink-400">—</span>}
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h3 className="flex items-center gap-2 border-b border-ink-400/10 p-4 font-bold">
            <Users className="h-4 w-4 text-hive-700" /> Users
          </h3>
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full">
              <tbody>
                {d.users?.map((u: any) => (
                  <tr key={u._id} className="border-b border-ink-400/10 last:border-0">
                    <td className="td">
                      <p className="font-semibold">
                        {u.name} {u.isOwner && <Badge color="honey">Owner</Badge>}
                      </p>
                      <p className="text-xs text-ink-500">{u.email}</p>
                    </td>
                    <td className="td whitespace-nowrap text-right text-xs text-ink-500">{u.lastLoginAt ? fmtDate(u.lastLoginAt, false) : "never signed in"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.users?.length && <Empty title="No users yet" hint="The owner login is created with the company." />}
          </div>
        </section>

        <section className="card overflow-hidden">
          <h3 className="flex items-center gap-2 border-b border-ink-400/10 p-4 font-bold">
            <TrendingUp className="h-4 w-4 text-hive-700" /> Latest leads
          </h3>
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full">
              <tbody>
                {d.recent?.map((l: any) => (
                  <tr key={l._id} className="border-b border-ink-400/10 last:border-0">
                    <td className="td">
                      <p className="font-semibold">{l.name || l.companyName || "—"}</p>
                      <p className="text-xs text-ink-500">
                        {l.source || "manual"} · {l.status}
                      </p>
                    </td>
                    <td className="td whitespace-nowrap text-right text-xs text-ink-500">{fmtDate(l.createdAt, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.recent?.length && <Empty title="No leads yet" hint="They appear as soon as a channel delivers one." />}
          </div>
        </section>
      </div>

      {d.subscription && (
        <section className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <CreditCard className="h-4 w-4 text-hive-700" /> Subscription
          </h3>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <span>
              <span className="text-ink-500">Plan </span>
              <b>{d.subscription.planName}</b>
            </span>
            <span>
              <span className="text-ink-500">Every </span>
              <b>{d.subscription.frequency}</b>
            </span>
            <span>
              <span className="text-ink-500">Amount </span>
              <b>{inr(d.subscription.amount)}</b>
            </span>
            {d.cycle && (
              <>
                <span>
                  <span className="text-ink-500">This cycle ends </span>
                  <b>{fmtDate(d.cycle.periodEnd, false)}</b>
                </span>
                <Badge color={d.cycle.status === "paid" ? "green" : d.cycle.status === "unpaid" ? "honey" : "red"}>{d.cycle.status}</Badge>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/* ───────────────────────── Company details ───────────────────────── */

export function DetailsTab({ form, set, plans }: { form: any; set: (k: string, v: any) => void; plans: string[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Company name" required hint="Shown across the app, bills and the login page">
        <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Short name" hint="Used where the full name doesn’t fit — reports, shortcuts. Empty = initials.">
        <input className="input" value={form.branding?.shortName || ""} onChange={(e) => set("branding", { ...form.branding, shortName: e.target.value })} />
      </Field>
      <Field label="Company code" required hint={form.dbName ? `Database: ${form.dbName} — fixed once created` : "Also the name of this company’s own database. Letters, numbers, - and _."}>
        <input className="input uppercase disabled:bg-ink-400/5" disabled={!!form._id} value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
      </Field>
      <Field label="Legal name" hint="The name on invoices, e.g. M/S. …">
        <input className="input" value={form.legalName || ""} onChange={(e) => set("legalName", e.target.value)} />
      </Field>
      <Field label="Business type">
        <select className="input" value={form.businessType || ""} onChange={(e) => set("businessType", e.target.value)}>
          <option value="">—</option>
          {BUSINESS_TYPES.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </Field>
      <Field label="GSTIN">
        <input className="input uppercase" maxLength={15} value={form.gstin || ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} />
      </Field>
      <Field label="Address" className="sm:col-span-2">
        <textarea className="input min-h-[70px]" value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
      </Field>
      <Field label="City">
        <input className="input" value={form.city || ""} onChange={(e) => set("city", e.target.value)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="State">
          <select className="input" value={form.state || ""} onChange={(e) => set("state", e.target.value)}>
            <option value="">—</option>
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="PIN code">
          <input className="input" inputMode="numeric" maxLength={6} value={form.pin || ""} onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <Field label="Contact person">
        <input className="input" value={form.contactPerson || ""} onChange={(e) => set("contactPerson", e.target.value)} />
      </Field>
      <Field label="Contact phone">
        <input className="input" inputMode="numeric" maxLength={10} value={form.phone || ""} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="WhatsApp" hint="10 digits, omit +91 — reminders and OTPs go here">
        <input className="input" inputMode="numeric" maxLength={10} value={form.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="Company email" required>
        <input className="input" type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <Field label="Contact email" hint="Where the platform writes, when different from the company email">
        <input className="input" type="email" placeholder={form.email} value={form.contactEmail || ""} onChange={(e) => set("contactEmail", e.target.value)} />
      </Field>
      <Field label="Account status">
        <select className="input" value={form.status || "active"} onChange={(e) => set("status", e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </Field>
    </div>
  );
}

/* ───────────────────────── Subscription ───────────────────────── */

export function SubscriptionTab({ form, set, plans, id }: { form: any; set: (k: string, v: any) => void; plans: string[]; id?: string }) {
  const [sub, setSub] = useState<any>(null);
  const [cycles, setCycles] = useState<any[]>([]);
  useEffect(() => {
    if (!id) return;
    api(`/sa/companies/${id}/overview`)
      .then((d) => {
        setSub(d.subscription);
        setCycles(d.cycle ? [d.cycle] : []);
      })
      .catch(() => {});
  }, [id]);

  const amount = Number(form.subAmount ?? sub?.amount ?? 0);
  const dType = form.subDiscountType ?? sub?.discountType ?? "flat";
  const dVal = Number(form.subDiscountValue ?? sub?.discountValue ?? 0);
  const discount = dType === "percent" ? Math.round(((amount * dVal) / 100) * 100) / 100 : dVal;
  const gross = Math.max(0, Math.round((amount - discount) * 100) / 100);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-2xl bg-hive-50/70 p-4 text-sm text-ink-700">
        <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
        <p>
          What this company pays and when. The due shows on the company’s Subscription page 7 days before the due date, and the contact gets WhatsApp reminders through the Super Admin webhook. Cycles and payment history stay under <b>Settings › Subscription Management</b>.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Plan" hint="From Plans — decides which modules the company has at all">
          <select className="input" value={form.plan} onChange={(e) => set("plan", e.target.value)}>
            {plans.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Payment frequency">
          <select className="input" value={form.subFrequency ?? sub?.frequency ?? "monthly"} onChange={(e) => set("subFrequency", e.target.value)}>
            {["weekly", "monthly", "quarterly", "half_yearly"].map((f) => (
              <option key={f} value={f}>
                {f.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment amount (₹)" hint="Filled from the plan for the frequency — you can change it">
          <input className="input" inputMode="decimal" value={form.subAmount ?? sub?.amount ?? ""} onChange={(e) => set("subAmount", e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label="First due date" hint="The subscription runs until then">
          <input className="input" type="date" value={form.subDueDate || ""} onChange={(e) => set("subDueDate", e.target.value)} />
        </Field>
        <Field label="Discount (₹)" hint="Enter ₹ or % — the other is calculated">
          <input
            className="input"
            inputMode="decimal"
            value={dType === "flat" ? (form.subDiscountValue ?? sub?.discountValue ?? "") : discount || ""}
            onChange={(e) => {
              set("subDiscountType", "flat");
              set("subDiscountValue", e.target.value.replace(/[^\d.]/g, ""));
            }}
          />
        </Field>
        <Field label="Discount (%)">
          <input
            className="input"
            inputMode="decimal"
            value={dType === "percent" ? (form.subDiscountValue ?? sub?.discountValue ?? "") : amount ? Math.round((discount / amount) * 10000) / 100 || "" : ""}
            onChange={(e) => {
              set("subDiscountType", "percent");
              set("subDiscountValue", e.target.value.replace(/[^\d.]/g, ""));
            }}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-400/15 bg-white px-4 py-3">
        <span className="text-sm text-ink-600">
          {inr(amount)} {discount ? `− ${inr(discount)} discount${amount ? ` (${Math.round((discount / amount) * 100)}%)` : ""}` : "no discount"}
        </span>
        <span className="text-lg font-bold">
          Gross: {inr(gross)} <span className="text-sm font-semibold text-ink-500">/ {String(form.subFrequency ?? sub?.frequency ?? "monthly").replace("_", " ")}</span>
        </span>
      </div>

      {cycles.length > 0 && (
        <section>
          <h3 className="mb-2 font-bold">Current cycle</h3>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-ink-400/15 p-4 text-sm">
            <span>
              <span className="text-ink-500">Period </span>
              <b>
                {fmtDate(cycles[0].periodStart, false)} → {fmtDate(cycles[0].periodEnd, false)}
              </b>
            </span>
            <Badge color={cycles[0].status === "paid" ? "green" : cycles[0].status === "unpaid" ? "honey" : "red"}>{cycles[0].status}</Badge>
          </div>
        </section>
      )}

      <p className="text-xs text-ink-500">Also switch on this plan’s modules and limits on the <b>Modules</b> tab.</p>
    </div>
  );
}

/* ───────────────────────── Login credentials ───────────────────────── */

export function LoginTab({ form, set }: { form: any; set: (k: string, v: any) => void }) {
  const [show, setShow] = useState(false);
  const gen = () => {
    const pool = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%";
    const a = new Uint32Array(14);
    crypto.getRandomValues(a);
    set("password", Array.from(a, (n) => pool[n % pool.length]).join(""));
    setShow(true);
  };
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="flex items-start gap-3 rounded-2xl bg-hive-50/70 p-4 sm:col-span-2">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
        <p className="text-sm text-ink-700">
          This is the <b>owner login</b>. The owner sees every module the plan allows and can create more users under Settings → Role Management. The owner signs in at{" "}
          <span className="mono">{(form.customUrl || form.platformUrl || "").replace("https://", "") || "the company’s address"}</span>.
        </p>
      </div>
      <Field label="Owner name">
        <input className="input" value={form.contactPerson || ""} onChange={(e) => set("contactPerson", e.target.value)} />
      </Field>
      <Field label="Mobile (WhatsApp)">
        <input className="input" inputMode="numeric" maxLength={10} value={form.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="Login email" required hint={form._id ? "Changing this moves the owner login to the new address" : "Defaults to the company email"}>
        <input className="input" type="email" placeholder={form.email} value={form.loginEmail || ""} onChange={(e) => set("loginEmail", e.target.value)} />
      </Field>
      <Field label="New password" hint={form._id ? "Leave empty to keep the current password" : "Min 8 characters"}>
        <div className="flex gap-2">
          <input className="input" type={show ? "text" : "password"} autoComplete="new-password" value={form.password || ""} onChange={(e) => set("password", e.target.value)} />
          <Btn type="button" variant="secondary" onClick={() => setShow(!show)}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {show ? "Hide" : "Show"}
          </Btn>
          <Btn type="button" variant="secondary" onClick={gen}>
            <KeyRound className="h-4 w-4" /> Generate
          </Btn>
        </div>
      </Field>
    </div>
  );
}

/* ───────────────────────── Mobile Modules ───────────────────────── */

/**
 * Which modules and sub-modules the company's mobile apps may use. The list is the module registry, so anything
 * added to the platform appears here by itself and starts ticked. Who may open each one still follows the plan,
 * the Modules tab and the company's roles.
 */
export function MobileModulesTab({ form, set, modules }: { form: any; set: (k: string, v: any) => void; modules: ModuleDef[] }) {
  const rows = permRows(modules);
  const all = rows.map((r) => r.key);
  const on: string[] = form.mobileModules ?? all;
  const isOn = (k: string) => on.includes(k);
  const toggle = (k: string, v: boolean) => {
    const row = rows.find((r) => r.key === k);
    let next = v ? [...on, k] : on.filter((x) => x !== k);
    if (row && !row.parent) for (const s of rows.filter((s) => s.parent === k)) next = v ? [...next, s.key] : next.filter((x) => x !== s.key);
    if (row?.parent && v && !next.includes(row.parent)) next.push(row.parent);
    set("mobileModules", Array.from(new Set(next)));
  };
  const [q, setQ] = useState("");
  const shown = rows.filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase()) || (r.parent && rows.find((p) => p.key === r.parent)?.label.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl bg-hive-50/70 p-4 text-sm text-ink-700">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
        <p>
          Tick what this company’s <b>mobile apps</b> may use; untick to keep a module or sub-module out of them. The list is the platform’s own menu, so modules added later show up here by themselves and start ticked. Who may open each module (plan, Modules tab, roles) still applies.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input className="input w-64" placeholder="Find a module…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-ink-500">
          {on.length} of {all.length} on
        </span>
        <div className="ml-auto flex gap-2">
          <Btn type="button" variant="secondary" onClick={() => set("mobileModules", all)}>
            All on
          </Btn>
          <Btn type="button" variant="secondary" onClick={() => set("mobileModules", [])}>
            All off
          </Btn>
          {form.mobileModules !== undefined && (
            <Btn type="button" variant="ghost" onClick={() => set("mobileModules", undefined)}>
              <RotateCcw className="h-3.5 w-3.5" /> Follow the platform
            </Btn>
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-ink-400/15">
        {["Main", "Settings"].map((group) => {
          const items = shown.filter((r) => !r.parent && (modules.find((m) => m.key === r.key)?.group || "Main") === group);
          if (!items.length) return null;
          return (
            <div key={group}>
              <p className="eyebrow bg-ink-400/[0.04] px-4 py-2 text-ink-500">{group}</p>
              {items.map((m) => (
                <div key={m.key} className="border-b border-ink-400/10 px-4 py-2.5 last:border-0">
                  <label className="flex items-center gap-2.5 font-semibold">
                    <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={isOn(m.key)} onChange={(e) => toggle(m.key, e.target.checked)} />
                    {m.label}
                  </label>
                  <div className="ml-7 mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
                    {shown
                      .filter((s) => s.parent === m.key)
                      .map((s) => (
                        <label key={s.key} className={`flex items-center gap-2 text-sm ${isOn(m.key) ? "text-ink-700" : "text-ink-400"}`}>
                          <input type="checkbox" className="h-3.5 w-3.5 accent-hive-700" disabled={!isOn(m.key)} checked={isOn(s.key) && isOn(m.key)} onChange={(e) => toggle(s.key, e.target.checked)} />
                          {s.label}
                        </label>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-500">The apps themselves are set up on the <b>Mobile App</b> tab (next release) — this list decides what they are allowed to show.</p>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Power, BellRing, LogIn, Trash2, Search, Bot, MoreHorizontal } from "lucide-react";
import { api, qs, fmtDate } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Empty, Pager, Confirm, Spinner, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";

const BLANK = { name: "", code: "", contactPerson: "", phone: "", whatsapp: "", email: "", plan: "Trial", gstin: "", address: "", loginEmail: "", password: "" };

export default function Companies() {
  const [data, setData] = useState<any>(null);
  const [f, setF] = useState({ q: "", plan: "", status: "", page: 1 });
  const [plans, setPlans] = useState<string[]>(["Trial", "Standard", "Pro", "Enterprise"]);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [reminder, setReminder] = useState<any>(null);
  const [remMsg, setRemMsg] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "delete" | "status"; c: any } | null>(null);
  const [ai, setAi] = useState<{ c: any; agents: any[]; alloc: Record<string, number> } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const perm = usePerm("companies");
  const toast = useToast();

  const load = useCallback(() => api(`/sa/companies${qs(f)}`).then(setData), [f]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api("/sa/plans").then((r) => setPlans(r.plans.map((p: any) => p.name))).catch(() => {});
  }, []);

  const set = (k: string, v: string) => setForm((p: any) => ({ ...p, [k]: v }));
  async function save() {
    setBusy(true);
    try {
      const body = { ...form };
      if (!body.password) delete body.password;
      if (form._id) await api(`/sa/companies/${form._id}`, { method: "PUT", body });
      else await api("/sa/companies", { body });
      toast("ok", form._id ? "Company updated" : "Company created");
      setForm(null);
      load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function openAi(c: any) {
    const [agents, detail] = await Promise.all([api("/sa/ai-agents"), api(`/sa/companies/${c._id}`)]);
    const alloc: Record<string, number> = {};
    for (const a of detail.allocations) alloc[a.agentId] = a.credits;
    setAi({ c, agents, alloc });
  }

  async function forceLogin(c: any) {
    try {
      const r = await api(`/auth/impersonate/${c._id}`, { method: "POST" });
      window.location.href = r.redirect;
    } catch (e: any) {
      toast("err", e.message);
    }
  }

  return (
    <>
      <PageHeader
        title="Company"
        subtitle="Tenants, their plans and admin logins"
        actions={
          perm.create && (
            <Btn onClick={() => setForm({ ...BLANK })}>
              <Plus className="h-4 w-4" /> Create
            </Btn>
          )
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input w-64 pl-9" placeholder="Search name, code, email" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
          </div>
          <select className="input w-auto" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value, page: 1 })} aria-label="Plan">
            <option value="">All plans</option>
            {plans.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} aria-label="Status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                {["Company", "Contact", "Login", "Plan", "Created On", "Status", "Action"].map((h) => (
                  <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c: any) => (
                <tr key={c._id} className="hover:bg-hive-50/40">
                  <td className="td">
                    <p className="font-semibold">{c.name}</p>
                    <p className="mono text-ink-400">{c.code}</p>
                  </td>
                  <td className="td">
                    <p>{c.contactPerson || "—"}</p>
                    <p className="text-xs text-ink-500">{c.whatsapp ? `WA ${c.whatsapp}` : c.phone || ""}</p>
                  </td>
                  <td className="td text-ink-700">{c.loginEmail || "—"}</td>
                  <td className="td">
                    <Badge color="honey">{c.plan}</Badge>
                  </td>
                  <td className="td whitespace-nowrap text-ink-500">{fmtDate(c.createdAt, false)}</td>
                  <td className="td">
                    <Badge color={c.status === "active" ? "green" : "red"}>{c.status === "active" ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      {perm.update && (
                        <button className="btn-ghost" title="Edit" aria-label="Edit" onClick={() => setForm({ ...BLANK, ...c, password: "" })}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {perm.update && (
                        <button className="btn-ghost" title="Reminder" aria-label="Reminder" onClick={() => (setReminder(c), setRemMsg(`Dear ${c.contactPerson || c.name},\n`))}>
                          <BellRing className="h-4 w-4" />
                        </button>
                      )}
                      {perm.update && c.status === "active" && (
                        <button className="btn-ghost" title="Force Login" aria-label="Force Login" onClick={() => forceLogin(c)}>
                          <LogIn className="h-4 w-4" />
                        </button>
                      )}
                      <div className="relative">
                        <button className="btn-ghost" aria-label="More actions" onClick={() => setMenu(menu === c._id ? null : c._id)}>
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menu === c._id && (
                          <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl border border-ink-400/15 bg-white py-1 shadow-lg" onMouseLeave={() => setMenu(null)}>
                            {perm.update && (
                              <button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-hive-50" onClick={() => (setMenu(null), openAi(c))}>
                                <Bot className="h-4 w-4" /> AI Agents & credits
                              </button>
                            )}
                            {perm.update && (
                              <button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-hive-50" onClick={() => (setMenu(null), setConfirm({ kind: "status", c }))}>
                                <Power className="h-4 w-4" /> {c.status === "active" ? "Deactivate" : "Activate"}
                              </button>
                            )}
                            {perm.delete && (
                              <button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50" onClick={() => (setMenu(null), setConfirm({ kind: "delete", c }))}>
                                <Trash2 className="h-4 w-4" /> Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
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
          {data && !data.items.length && <Empty title="No companies yet" hint="Create the first tenant to get started." />}
        </div>
        {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </div>

      {/* Create / Edit */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? "Edit company" : "Create company"}
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
        {form && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Company name" required>
              <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Company code" required hint="Short unique code, e.g. WHIVE">
              <input className="input uppercase" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} />
            </Field>
            <Field label="Contact person">
              <input className="input" value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />
            </Field>
            <Field label="Phone">
              <input className="input" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="WhatsApp" hint="10-digit number, omit +91">
              <input className="input" inputMode="numeric" maxLength={10} value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Company email" required>
              <input className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Plan">
              <select className="input" value={form.plan} onChange={(e) => set("plan", e.target.value)}>
                {plans.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="GSTIN">
              <input className="input uppercase" maxLength={15} value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <textarea className="input min-h-[70px]" value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <p className="border-t border-ink-400/15 pt-4 text-sm font-bold text-ink-900">Login credentials</p>
            </div>
            <Field label="Login email" hint="Defaults to company email">
              <input className="input" type="email" placeholder={form.email} value={form.loginEmail} onChange={(e) => set("loginEmail", e.target.value)} />
            </Field>
            <Field label="Password" required={!form._id} hint={form._id ? "Leave blank to keep the current password" : "Min 8 characters"}>
              <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      {/* Reminder */}
      <Modal
        open={!!reminder}
        onClose={() => setReminder(null)}
        title={`Reminder · ${reminder?.name || ""}`}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setReminder(null)}>
              Cancel
            </Btn>
            <Btn
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api(`/sa/companies/${reminder._id}/reminder`, { body: { message: remMsg } });
                  toast(r.sent ? "ok" : "err", r.sent ? `Sent to ${reminder.whatsapp || reminder.phone}` : r.reason || "Send failed — see WhatsApp Logs");
                  if (r.sent) setReminder(null);
                } catch (e: any) {
                  toast("err", e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send on WhatsApp
            </Btn>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-500">Goes to {reminder?.whatsapp || reminder?.phone || "—"} via the active “Company reminder” webhook(s).</p>
        <textarea className="input min-h-[150px]" value={remMsg} onChange={(e) => setRemMsg(e.target.value)} />
      </Modal>

      {/* AI allocation */}
      <Modal
        open={!!ai}
        onClose={() => setAi(null)}
        title={`AI Agents · ${ai?.c.name || ""}`}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setAi(null)}>
              Cancel
            </Btn>
            <Btn
              onClick={async () => {
                try {
                  await api(`/sa/companies/${ai!.c._id}/ai`, { method: "PUT", body: Object.entries(ai!.alloc).map(([agentId, credits]) => ({ agentId, credits })) });
                  toast("ok", "Credits allocated");
                  setAi(null);
                } catch (e: any) {
                  toast("err", e.message);
                }
              }}
            >
              Save allocation
            </Btn>
          </>
        }
      >
        {ai && !ai.agents.length && <Empty title="No AI agents defined" hint="Create one under AI Agents first." />}
        <div className="space-y-3">
          {ai?.agents.map((a: any) => (
            <div key={a._id} className="flex items-center justify-between gap-4 rounded-xl border border-ink-400/15 p-3">
              <div>
                <p className="font-semibold">{a.name}</p>
                <p className="text-xs text-ink-500">
                  {a.provider} · {a.llmVersion} · default {a.credits} credits
                </p>
              </div>
              <input
                type="number"
                min={0}
                className="input w-32"
                placeholder="0"
                aria-label={`Credits for ${a.name}`}
                value={ai.alloc[a._id] ?? ""}
                onChange={(e) => setAi({ ...ai, alloc: { ...ai.alloc, [a._id]: Number(e.target.value) } })}
              />
            </div>
          ))}
        </div>
      </Modal>

      <Confirm
        open={!!confirm}
        danger={confirm?.kind === "delete" || confirm?.c.status === "active"}
        title={confirm?.kind === "delete" ? "Delete company?" : confirm?.c.status === "active" ? "Deactivate company?" : "Activate company?"}
        body={confirm?.kind === "delete" ? `${confirm.c.name} and its logins will be removed. Leads are retained for audit but no longer accessible.` : confirm?.c.status === "active" ? `All users of ${confirm?.c.name} will be signed out and blocked from logging in.` : `${confirm?.c.name} users will be able to log in again.`}
        confirmLabel={confirm?.kind === "delete" ? "Delete" : confirm?.c.status === "active" ? "Deactivate" : "Activate"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            if (confirm!.kind === "delete") await api(`/sa/companies/${confirm!.c._id}`, { method: "DELETE" });
            else await api(`/sa/companies/${confirm!.c._id}/status`, { body: { status: confirm!.c.status === "active" ? "inactive" : "active" } });
            toast("ok", "Done");
            load();
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </>
  );
}

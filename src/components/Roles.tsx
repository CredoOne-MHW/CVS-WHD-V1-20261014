"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2, UserPlus, Pencil } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Btn, Field, Modal, Badge, Empty, Spinner, Confirm, Lookup, useToast, type LookupItem } from "./ui";
import { PermGrid } from "./PermGrid";
import { usePerm } from "./Shell";
import { Tabs } from "./Logs";
import type { PermMap } from "@shared/constants";

/**
 * Super Admin: role templates per plan (pick plan from dropdown; grid capped by that plan).
 * Company Admin: company roles (capped by the company's plan) + users assigned to them.
 */
export function RoleManager({ base }: { base: "/sa" | "/co" }) {
  const isSA = base === "/sa";
  const [plans, setPlans] = useState<string[]>([]);
  const [plan, setPlan] = useState("");
  const [data, setData] = useState<any>(null);
  const [roleId, setRoleId] = useState("");
  const [draft, setDraft] = useState<any>(null);
  const [newRole, setNewRole] = useState("");
  const [tab, setTab] = useState<"roles" | "users">("roles");
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("roles:roles");
  const usersPerm = usePerm("roles:users");
  const toast = useToast();
  const tabs = [perm.read && { key: "roles" as const, label: "Roles" }, usersPerm.read && { key: "users" as const, label: "Users" }].filter(Boolean) as { key: "roles" | "users"; label: string }[];
  useEffect(() => {
    if (!isSA && tabs.length && !tabs.some((t) => t.key === tab)) setTab(tabs[0].key);
  }, [tabs.length, tab, isSA]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isSA)
      api("/sa/plans").then((d) => {
        const names = d.plans.map((p: any) => p.name);
        setPlans(names);
        setPlan(names[0] || "");
      });
  }, [isSA]);

  const load = (keep?: string) =>
    api(`${base}/roles${isSA ? `?plan=${encodeURIComponent(plan)}` : ""}`).then((d) => {
      setData(d);
      const r = d.roles.find((x: any) => x._id === keep) || d.roles[0];
      setRoleId(r?._id || "");
      setDraft(r ? structuredClone(r) : null);
    });
  useEffect(() => {
    if (!isSA || plan) load();
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    try {
      const tpl = data.templates?.[0];
      const r = await api(`${base}/roles`, { body: { name: newRole, plan, permissions: tpl?.permissions || data.planCaps || {} } });
      setNewRole("");
      toast("ok", "Role created");
      load(r._id);
    } catch (e: any) {
      toast("err", e.message);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await api(`${base}/roles/${draft._id}`, { method: "PUT", body: { name: draft.name, permissions: draft.permissions } });
      toast("ok", "Role saved");
      load(draft._id);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!isSA && tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs} />}
      {tab === "users" && !isSA ? (
        <Users roles={data?.roles || []} />
      ) : (
        <div className="card p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-end gap-4">
            {isSA && (
              <Field label="Plan" className="w-56">
                <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
                  {plans.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Role" className="w-64">
              <select
                className="input"
                value={roleId}
                onChange={(e) => {
                  setRoleId(e.target.value);
                  setDraft(structuredClone(data.roles.find((r: any) => r._id === e.target.value)));
                }}
                disabled={!data?.roles.length}
              >
                {!data?.roles.length && <option>No roles yet</option>}
                {data?.roles.map((r: any) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            {perm.create && (
              <div className="flex items-end gap-2">
                <Field label="New role" className="w-56">
                  <input className="input" placeholder={isSA ? "e.g. Sales Executive" : "e.g. Front desk"} value={newRole} onChange={(e) => setNewRole(e.target.value)} />
                </Field>
                <Btn variant="secondary" disabled={newRole.trim().length < 2} onClick={create}>
                  <Plus className="h-4 w-4" /> Add
                </Btn>
              </div>
            )}
          </div>
          {!data ? (
            <div className="flex justify-center py-16 text-hive-700">
              <Spinner className="h-6 w-6" />
            </div>
          ) : draft ? (
            <>
              <PermGrid withSubs modules={data.modules} caps={data.planCaps} value={draft.permissions || {}} onChange={(p: PermMap) => setDraft({ ...draft, permissions: p })} disabled={!perm.update} />
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-500">
                  {isSA ? "Role templates are offered to every company on this plan." : "Company owners always have full plan access."} Greyed boxes aren’t included in the plan.
                </p>
                <div className="flex gap-2">
                  {perm.delete && (
                    <Btn variant="secondary" onClick={() => setDel(true)}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </Btn>
                  )}
                  {perm.update && (
                    <Btn loading={busy} onClick={save}>
                      <Save className="h-4 w-4" /> Save role
                    </Btn>
                  )}
                </div>
              </div>
            </>
          ) : (
            <Empty title="No roles yet" hint="Add a role, then tick the modules and actions it may use." />
          )}
        </div>
      )}
      <Confirm
        open={del}
        danger
        title={`Delete role “${draft?.name}”?`}
        body="Users with this role will lose access until they are given another role."
        confirmLabel="Delete"
        onClose={() => setDel(false)}
        onConfirm={async () => {
          await api(`${base}/roles/${draft._id}`, { method: "DELETE" });
          load();
        }}
      />
    </div>
  );
}

function Users({ roles: fromParent }: { roles: any[] }) {
  const [list, setList] = useState<any[] | null>(null);
  /**
   * The parent's role list comes from `/co/roles`, which needs Role Management › Roles. Somebody who may add
   * users but not edit roles gets nothing from it, which used to leave "Add user" permanently disabled. The
   * narrower endpoint answers under the narrower permission, so it is asked only when the parent came empty.
   */
  const [own, setOwn] = useState<any[]>([]);
  const roles = fromParent.length ? fromParent : own;
  useEffect(() => {
    if (fromParent.length) return;
    api("/co/assignable-roles")
      .then((r: any) => setOwn(r.roles || []))
      .catch(() => {});
  }, [fromParent.length]);
  const [form, setForm] = useState<any>(null);
  const perm = usePerm("roles:users");
  const toast = useToast();
  const load = () => api("/co/users").then(setList);
  useEffect(() => {
    load();
  }, []);
  const roleName = (id: string) => roles.find((r) => r._id === id)?.name || "—";
  /** Stable, so the dropdown's own debounce and cache are not thrown away on every keystroke upstream. */
  const findPeople = useCallback(
    (q: string) => api(`/co/people-lookup${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r: any) => r.results as LookupItem[]),
    []
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex justify-end border-b border-ink-400/15 p-4">
        {perm.create && (
          <Btn onClick={() => setForm({ name: "", email: "", phone: "", password: "", roleId: roles[0]?._id || "", kind: "staff", mapped: null })} disabled={!roles.length}>
            <UserPlus className="h-4 w-4" /> Add user
          </Btn>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              {["Name", "Email", "WhatsApp", "Type", "Role", "Last login", "Status", ""].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list?.map((u) => (
              <tr key={u._id}>
                <td className="td font-semibold">{u.name}</td>
                <td className="td">{u.email}</td>
                <td className="td mono">{u.phone || "—"}</td>
                <td className="td">
                  {u.kind === "customer" ? (
                    <span className="flex flex-col items-start gap-1">
                      <Badge color="green">Customer</Badge>
                      {u.mappedTo && <span className="text-xs text-ink-400">{u.mappedTo}</span>}
                    </span>
                  ) : (
                    <span className="text-ink-500">Staff</span>
                  )}
                </td>
                <td className="td">{u.isOwner ? <Badge color="honey">Owner</Badge> : roleName(u.roleId)}</td>
                <td className="td text-ink-500">{fmtDate(u.lastLoginAt)}</td>
                <td className="td">
                  <Badge color={u.active ? "green" : "gray"}>{u.active ? "Active" : "Disabled"}</Badge>
                </td>
                <td className="td text-right">
                  {perm.update && (
                    <button
                      className="btn-ghost"
                      aria-label="Edit user"
                      onClick={() =>
                        setForm({
                          ...u,
                          password: "",
                          kind: u.kind || "staff",
                          mapped: u.clientId || u.leadId ? { id: String(u.clientId || u.leadId), label: u.mappedTo || "Linked record", kind: u.clientId ? "client" : "lead" } : null,
                        })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? "Edit user" : "Add user"}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Btn>
            <Btn
              onClick={async () => {
                try {
                  const body = { ...form };
                  if (!body.password) delete body.password;
                  delete body.mapped;
                  delete body.mappedTo;
                  /**
                   * A customer may be mapped to a client or to a lead, and the server decides which field it
                   * lands in from the record itself — the browser only says which record was chosen.
                   */
                  const picked: LookupItem | null = form.kind === "customer" ? form.mapped : null;
                  const map = { kind: form.kind || "staff", clientId: picked?.kind === "client" ? picked.id : "", leadId: picked?.kind === "lead" ? picked.id : "" };
                  if (form._id) await api(`/co/users/${form._id}`, { method: "PUT", body: { name: body.name, phone: body.phone, roleId: form.isOwner ? undefined : body.roleId, active: form.isOwner ? undefined : body.active, password: body.password, ...(form.isOwner ? {} : map) } });
                  else await api("/co/users", { body: { ...body, ...map } });
                  setForm(null);
                  load();
                  toast("ok", "Saved");
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
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email" required>
              <input className="input" type="email" disabled={!!form._id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="WhatsApp" hint="Receives delete OTPs">
              <input className="input" maxLength={10} inputMode="numeric" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="Role" hint="What this person may open and change">
              <select className="input" disabled={form.isOwner} value={form.roleId || ""} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                {roles.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Password" required={!form._id} hint={form._id ? "Blank keeps current" : "Min 8 characters"}>
              <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            {form._id && !form.isOwner && (
              <Field label="Status">
                <select className="input" value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                  <option value="1">Active</option>
                  <option value="0">Disabled</option>
                </select>
              </Field>
            )}
            {/* last, because the searchable list opens downward and pushes whatever follows it out of view */}
            {!form.isOwner && (
              <Field label="User type" hint={form.kind === "customer" ? "Signs in to talk to you, not to work here" : "Works here"}>
                <select className="input" value={form.kind || "staff"} onChange={(e) => setForm({ ...form, kind: e.target.value, mapped: e.target.value === "customer" ? form.mapped : null })}>
                  <option value="staff">Staff</option>
                  <option value="customer">Customer</option>
                </select>
              </Field>
            )}
            {form.kind === "customer" && !form.isOwner && (
              <Field label="Client / Lead" className="sm:col-span-2" hint="Optional — ties this sign-in to a record you already have, so a conversation sits next to their history">
                <Lookup value={form.mapped} onPick={(item) => setForm({ ...form, mapped: item })} search={findPeople} placeholder="Search name, phone, email or client code…" emptyText="No client or lead matches" />
              </Field>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

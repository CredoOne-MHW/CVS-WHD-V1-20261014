"use client";
import { useEffect, useState } from "react";
import { Plus, Save, Trash2, UserPlus, Pencil } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Btn, Field, Modal, Badge, Empty, Spinner, Confirm, useToast } from "./ui";
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
  const perm = usePerm("roles");
  const toast = useToast();

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
      {!isSA && <Tabs value={tab} onChange={setTab} tabs={[{ key: "roles", label: "Roles" }, { key: "users", label: "Users" }]} />}
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
              <PermGrid modules={data.modules} caps={data.planCaps} value={draft.permissions || {}} onChange={(p: PermMap) => setDraft({ ...draft, permissions: p })} disabled={!perm.update} />
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

function Users({ roles }: { roles: any[] }) {
  const [list, setList] = useState<any[] | null>(null);
  const [form, setForm] = useState<any>(null);
  const perm = usePerm("roles");
  const toast = useToast();
  const load = () => api("/co/users").then(setList);
  useEffect(() => {
    load();
  }, []);
  const roleName = (id: string) => roles.find((r) => r._id === id)?.name || "—";

  return (
    <div className="card overflow-hidden">
      <div className="flex justify-end border-b border-ink-400/15 p-4">
        {perm.create && (
          <Btn onClick={() => setForm({ name: "", email: "", phone: "", password: "", roleId: roles[0]?._id || "" })} disabled={!roles.length}>
            <UserPlus className="h-4 w-4" /> Add user
          </Btn>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              {["Name", "Email", "WhatsApp", "Role", "Last login", "Status", ""].map((h) => (
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
                <td className="td">{u.isOwner ? <Badge color="honey">Owner</Badge> : roleName(u.roleId)}</td>
                <td className="td text-ink-500">{fmtDate(u.lastLoginAt)}</td>
                <td className="td">
                  <Badge color={u.active ? "green" : "gray"}>{u.active ? "Active" : "Disabled"}</Badge>
                </td>
                <td className="td text-right">
                  {perm.update && (
                    <button className="btn-ghost" aria-label="Edit user" onClick={() => setForm({ ...u, password: "" })}>
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
                  if (form._id) await api(`/co/users/${form._id}`, { method: "PUT", body: { name: body.name, phone: body.phone, roleId: form.isOwner ? undefined : body.roleId, active: form.isOwner ? undefined : body.active, password: body.password } });
                  else await api("/co/users", { body });
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
            <Field label="Role">
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
          </div>
        )}
      </Modal>
    </div>
  );
}

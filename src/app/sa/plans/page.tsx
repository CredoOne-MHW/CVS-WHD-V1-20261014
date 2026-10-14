"use client";
import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { api, inr } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Spinner, Confirm, useToast } from "@/components/ui";
import { PermGrid } from "@/components/PermGrid";
import { usePerm } from "@/components/Shell";
import type { PermMap } from "@shared/constants";

export default function Plans() {
  const [data, setData] = useState<{ modules: any[]; plans: any[] } | null>(null);
  const [sel, setSel] = useState("");
  const [draft, setDraft] = useState<any>(null);
  const [create, setCreate] = useState<any>(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("plans");
  const toast = useToast();

  const load = (keep?: string) =>
    api("/sa/plans").then((d) => {
      setData(d);
      const id = keep || sel || d.plans[0]?._id;
      setSel(id);
      setDraft(structuredClone(d.plans.find((p: any) => p._id === id) || d.plans[0]));
    });
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !draft)
    return (
      <div className="flex justify-center py-24 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  async function save() {
    setBusy(true);
    try {
      await api(`/sa/plans/${draft._id}`, { method: "PUT", body: { description: draft.description, priceMonthly: draft.priceMonthly, leadLimit: draft.leadLimit, userLimit: draft.userLimit, permissions: draft.permissions } });
      toast("ok", `${draft.name} plan saved`);
      load(draft._id);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Plan"
        subtitle="Pick a plan, then choose which Company modules it unlocks and with what scope."
        actions={
          perm.create && (
            <Btn onClick={() => setCreate({ name: "", priceMonthly: 0, leadLimit: 0, userLimit: 0, description: "" })}>
              <Plus className="h-4 w-4" /> Create
            </Btn>
          )
        }
      />
      <div className="card p-5 sm:p-6">
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Plan" className="lg:col-span-1">
            <select
              className="input"
              value={sel}
              onChange={(e) => {
                setSel(e.target.value);
                setDraft(structuredClone(data.plans.find((p) => p._id === e.target.value)));
              }}
            >
              {data.plans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({p.companies} companies)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price / month (₹)">
            <input className="input" type="number" min={0} disabled={!perm.update} value={draft.priceMonthly} onChange={(e) => setDraft({ ...draft, priceMonthly: Number(e.target.value) })} />
          </Field>
          <Field label="Lead limit" hint="0 = unlimited">
            <input className="input" type="number" min={0} disabled={!perm.update} value={draft.leadLimit} onChange={(e) => setDraft({ ...draft, leadLimit: Number(e.target.value) })} />
          </Field>
          <Field label="User limit" hint="0 = unlimited">
            <input className="input" type="number" min={0} disabled={!perm.update} value={draft.userLimit} onChange={(e) => setDraft({ ...draft, userLimit: Number(e.target.value) })} />
          </Field>
          <Field label="Description">
            <input className="input" disabled={!perm.update} value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
        </div>
        <PermGrid modules={data.modules} value={draft.permissions || {}} onChange={(p: PermMap) => setDraft({ ...draft, permissions: p })} disabled={!perm.update} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-500">
            <Badge color="honey">{draft.name}</Badge> <span className="ml-2">{inr(draft.priceMonthly)}/month · New Company modules appear in this grid automatically.</span>
          </p>
          <div className="flex gap-2">
            {perm.delete && (
              <Btn variant="secondary" onClick={() => setDel(true)}>
                <Trash2 className="h-4 w-4" /> Delete plan
              </Btn>
            )}
            {perm.update && (
              <Btn loading={busy} onClick={save}>
                <Save className="h-4 w-4" /> Save access
              </Btn>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={!!create}
        onClose={() => setCreate(null)}
        title="Create plan"
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setCreate(null)}>
              Cancel
            </Btn>
            <Btn
              disabled={!create?.name}
              onClick={async () => {
                try {
                  const p = await api("/sa/plans", { body: create });
                  setCreate(null);
                  toast("ok", "Plan created — now set its module access");
                  load(p._id);
                } catch (e: any) {
                  toast("err", e.message);
                }
              }}
            >
              Create
            </Btn>
          </>
        }
      >
        {create && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan name" required className="sm:col-span-2">
              <input className="input" value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
            </Field>
            <Field label="Price / month (₹)">
              <input className="input" type="number" value={create.priceMonthly} onChange={(e) => setCreate({ ...create, priceMonthly: Number(e.target.value) })} />
            </Field>
            <Field label="Lead limit">
              <input className="input" type="number" value={create.leadLimit} onChange={(e) => setCreate({ ...create, leadLimit: Number(e.target.value) })} />
            </Field>
          </div>
        )}
      </Modal>
      <Confirm
        open={del}
        danger
        title={`Delete ${draft.name}?`}
        body="Only plans with no companies on them can be deleted."
        confirmLabel="Delete"
        onClose={() => setDel(false)}
        onConfirm={async () => {
          try {
            await api(`/sa/plans/${draft._id}`, { method: "DELETE" });
            setSel("");
            load(data.plans.find((p) => p._id !== draft._id)?._id);
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </>
  );
}

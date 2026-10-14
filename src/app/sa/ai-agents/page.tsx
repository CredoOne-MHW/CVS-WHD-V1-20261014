"use client";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { api, inr } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Empty, Confirm, Spinner, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";

const PROVIDERS = [
  { v: "anthropic", l: "Anthropic", url: "https://api.anthropic.com" },
  { v: "openai", l: "OpenAI", url: "https://api.openai.com/v1" },
  { v: "google", l: "Google Gemini", url: "https://generativelanguage.googleapis.com" },
  { v: "openai-compatible", l: "OpenAI-compatible", url: "" },
];
const BLANK = { name: "", llmVersion: "", provider: "anthropic", url: "https://api.anthropic.com", apiKey: "", tokenWeights: { input: 1, output: 3 }, actualRate: 0, companyRate: 0, credits: 100, active: true };

export default function AiAgents() {
  const [list, setList] = useState<any[] | null>(null);
  const [form, setForm] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("ai_agents");
  const toast = useToast();
  const load = () => api("/sa/ai-agents").then(setList);
  useEffect(() => {
    load();
  }, []);
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      const body = { ...form };
      if (!body.apiKey) delete body.apiKey;
      if (form._id) await api(`/sa/ai-agents/${form._id}`, { method: "PUT", body });
      else await api("/sa/ai-agents", { body });
      toast("ok", "Saved");
      setForm(null);
      load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="AI Agents"
        subtitle="LLM models offered to companies, their rates and credit pools"
        actions={
          perm.create && (
            <Btn onClick={() => setForm({ ...BLANK })}>
              <Plus className="h-4 w-4" /> Create
            </Btn>
          )
        }
      />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr>
              {["Name", "Provider", "LLM version", "Token weights (in/out)", "Actual rate", "Company rate", "Margin", "Credits (default)", "Allocated / used", "Status", ""].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list?.map((a) => (
              <tr key={a._id} className="hover:bg-hive-50/40">
                <td className="td font-semibold">{a.name}</td>
                <td className="td capitalize">{a.provider}</td>
                <td className="td mono">{a.llmVersion}</td>
                <td className="td tabular-nums">
                  {a.tokenWeights?.input} / {a.tokenWeights?.output}
                </td>
                <td className="td tabular-nums">{inr(a.actualRate)}</td>
                <td className="td tabular-nums">{inr(a.companyRate)}</td>
                <td className={`td tabular-nums font-semibold ${a.margin >= 0 ? "text-hive-700" : "text-red-600"}`}>{inr(a.margin)}</td>
                <td className="td tabular-nums">{a.credits}</td>
                <td className="td tabular-nums">
                  {a.allocated.toLocaleString("en-IN")} / {a.used.toFixed(1)} <span className="text-xs text-ink-400">({a.companies} cos)</span>
                </td>
                <td className="td">
                  <Badge color={a.active ? "green" : "gray"}>{a.active ? "Active" : "Off"}</Badge>
                </td>
                <td className="td whitespace-nowrap text-right">
                  {perm.update && (
                    <button className="btn-ghost" aria-label="Edit" onClick={() => setForm({ ...BLANK, ...a, apiKey: "" })}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {perm.delete && (
                    <button className="btn-ghost text-red-600" aria-label="Delete" onClick={() => setDel(a)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list && (
          <div className="flex justify-center py-16 text-hive-700">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {list && !list.length && <Empty title="No AI agents" hint="Add a model, then allocate credits to companies from the Company list." />}
      </div>
      <p className="mt-3 text-xs text-ink-500">Rates are ₹ per 1,000 weighted tokens. Weighted tokens = input × input weight + output × output weight. One credit = 1,000 weighted tokens.</p>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? "Edit AI agent" : "Create AI agent"}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Btn>
            <Btn loading={busy} onClick={save} disabled={!form?.name || !form?.llmVersion}>
              Save
            </Btn>
          </>
        }
      >
        {form && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" required>
              <input className="input" placeholder="e.g. Lead Qualifier – Sonnet" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Provider" required>
              <select className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value, url: PROVIDERS.find((p) => p.v === e.target.value)?.url || form.url })}>
                {PROVIDERS.map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="LLM version" required hint="Exact model id from the provider">
              <input className="input mono" placeholder="claude-sonnet-5-5" value={form.llmVersion} onChange={(e) => set("llmVersion", e.target.value)} />
            </Field>
            <Field label="URL" hint="API base URL">
              <input className="input" value={form.url} onChange={(e) => set("url", e.target.value)} />
            </Field>
            <Field label="API key" className="sm:col-span-2" hint={form._id ? "Stored encrypted. Leave blank to keep the current key." : "Stored encrypted, never shown again."}>
              <input className="input mono" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => set("apiKey", e.target.value)} />
            </Field>
            <Field label="Token weight – input">
              <input className="input" type="number" step="0.1" min={0} value={form.tokenWeights.input} onChange={(e) => set("tokenWeights", { ...form.tokenWeights, input: Number(e.target.value) })} />
            </Field>
            <Field label="Token weight – output">
              <input className="input" type="number" step="0.1" min={0} value={form.tokenWeights.output} onChange={(e) => set("tokenWeights", { ...form.tokenWeights, output: Number(e.target.value) })} />
            </Field>
            <Field label="Actual rate (₹ / 1k weighted tokens)">
              <input className="input" type="number" step="0.01" min={0} value={form.actualRate} onChange={(e) => set("actualRate", Number(e.target.value))} />
            </Field>
            <Field label="Company rate (₹ / 1k weighted tokens)">
              <input className="input" type="number" step="0.01" min={0} value={form.companyRate} onChange={(e) => set("companyRate", Number(e.target.value))} />
            </Field>
            <Field label="Credits to be allocated" hint="Default credits suggested per company">
              <input className="input" type="number" min={0} value={form.credits} onChange={(e) => set("credits", Number(e.target.value))} />
            </Field>
            <Field label="Status">
              <select className="input" value={form.active ? "1" : "0"} onChange={(e) => set("active", e.target.value === "1")}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </Field>
          </div>
        )}
      </Modal>
      <Confirm
        open={!!del}
        danger
        title="Delete AI agent?"
        body={`${del?.name} will no longer be available to companies.`}
        confirmLabel="Delete"
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await api(`/sa/ai-agents/${del._id}`, { method: "DELETE" });
          load();
        }}
      />
    </>
  );
}

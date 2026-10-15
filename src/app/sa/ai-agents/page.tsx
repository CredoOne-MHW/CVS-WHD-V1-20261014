"use client";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { api, inr } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Empty, Confirm, Spinner, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";

const BLANK = { name: "", llmVersion: "", provider: "openrouter", url: "", apiKey: "", tokenWeights: { input: 1, output: 3 }, actualRate: 0, companyRate: 0, credits: 100, active: true };
const ADD = "__add__";
const MANAGE = "__manage__";
const NEW_PROVIDER = { name: "", apiStyle: "openai", baseUrl: "https://", modelsUrl: "" };

export default function AiAgents() {
  const [list, setList] = useState<any[] | null>(null);
  const [form, setForm] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<any[]>([]);
  const [provForm, setProvForm] = useState<any>(null);
  const [manage, setManage] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const perm = usePerm("ai_agents");
  const toast = useToast();
  const load = () => api("/sa/ai-agents").then(setList);
  const loadProviders = () => api("/sa/ai-providers").then(setProviders);
  useEffect(() => {
    load();
    loadProviders();
  }, []);
  const provName = (k: string) => providers.find((p) => p.key === k)?.name || k;

  async function loadModels() {
    const p = providers.find((x) => x.key === form.provider);
    if (!p) return;
    setLoadingModels(true);
    try {
      setModels(await api(`/sa/ai-providers/${p._id}/models`, { body: { apiKey: form.apiKey || undefined } }));
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setLoadingModels(false);
    }
  }
  const picked = models.find((m) => m.id === form?.llmVersion);
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
            <Btn onClick={() => (setModels([]), setForm({ ...BLANK, provider: providers[0]?.key || "openrouter" }))}>
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
                <td className="td">{provName(a.provider)}</td>
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
                    <button className="btn-ghost" aria-label="Edit" onClick={() => (setModels([]), setForm({ ...BLANK, ...a, apiKey: "" }))}>
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
            <Field label="Provider" required hint="Pick “+ Add provider…” or “Manage providers…” to change this list">
              <select
                className="input"
                value={form.provider}
                onChange={(e) => {
                  if (e.target.value === ADD) return setProvForm({ ...NEW_PROVIDER });
                  if (e.target.value === MANAGE) return setManage(true);
                  setModels([]);
                  setForm({ ...form, provider: e.target.value });
                }}
              >
                {providers.map((p) => (
                  <option key={p._id} value={p.key}>
                    {p.name}
                  </option>
                ))}
                {perm.create && <option value={ADD}>+ Add provider…</option>}
                {perm.delete && <option value={MANAGE}>Manage providers…</option>}
              </select>
            </Field>
            <Field label="LLM version" required hint={picked?.priceIn != null ? `≈ $${picked.priceIn.toFixed(2)} in / $${(picked.priceOut ?? 0).toFixed(2)} out per 1M tokens${picked.context ? ` · ${Math.round(picked.context / 1000)}k context` : ""}` : "Exact model id — or load the provider’s list"}>
              <div className="flex gap-2">
                <input className="input mono" list="llm-models" placeholder={form.provider === "openrouter" ? "anthropic/claude-sonnet-4.5" : "model-id"} value={form.llmVersion} onChange={(e) => set("llmVersion", e.target.value)} />
                <button type="button" className="btn-secondary shrink-0 px-3" onClick={loadModels} disabled={loadingModels} aria-label="Load models from provider" title="Load models from provider">
                  <RefreshCw className={`h-4 w-4 ${loadingModels ? "animate-spin" : ""}`} />
                </button>
              </div>
              <datalist id="llm-models">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="URL override" hint={`Optional — default ${providers.find((p) => p.key === form.provider)?.baseUrl || ""}`} className="sm:col-span-2">
              <input className="input" value={form.url} placeholder="Leave blank to use the provider’s URL" onChange={(e) => set("url", e.target.value)} />
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
      <Modal
        open={!!provForm}
        onClose={() => setProvForm(null)}
        title="Add AI provider"
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setProvForm(null)}>
              Cancel
            </Btn>
            <Btn
              disabled={!provForm?.name || !provForm?.baseUrl}
              onClick={async () => {
                try {
                  const p = await api("/sa/ai-providers", { body: provForm });
                  await loadProviders();
                  setForm((f: any) => (f ? { ...f, provider: p.key } : f));
                  setProvForm(null);
                  toast("ok", `${p.name} added`);
                } catch (e: any) {
                  toast("err", e.message);
                }
              }}
            >
              Add provider
            </Btn>
          </>
        }
      >
        {provForm && (
          <div className="grid gap-4">
            <Field label="Name" required>
              <input className="input" placeholder="e.g. Together AI" value={provForm.name} onChange={(e) => setProvForm({ ...provForm, name: e.target.value })} />
            </Field>
            <Field label="API format" hint="Most gateways (OpenRouter, Groq, Together, Azure-compatible…) use the OpenAI format">
              <select className="input" value={provForm.apiStyle} onChange={(e) => setProvForm({ ...provForm, apiStyle: e.target.value })}>
                <option value="openai">OpenAI-compatible (/chat/completions)</option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="google">Google Gemini</option>
              </select>
            </Field>
            <Field label="Base URL" required>
              <input className="input font-mono" value={provForm.baseUrl} onChange={(e) => setProvForm({ ...provForm, baseUrl: e.target.value })} />
            </Field>
            <Field label="Models list URL" hint="Optional — enables the model picker">
              <input className="input font-mono" value={provForm.modelsUrl} onChange={(e) => setProvForm({ ...provForm, modelsUrl: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={manage} onClose={() => setManage(false)} title="Manage AI providers" size="md" footer={<Btn onClick={() => setManage(false)}>Done</Btn>}>
        <ul className="divide-y divide-ink-400/10 rounded-2xl border border-ink-400/15">
          {providers.map((p) => (
            <li key={p._id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">{p.name}</p>
                <p className="truncate font-mono text-xs text-ink-500">{p.baseUrl}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p.agents > 0 && <Badge>{p.agents} in use</Badge>}
                <button
                  className="btn-ghost text-red-600 disabled:opacity-30"
                  aria-label={`Remove ${p.name}`}
                  disabled={p.agents > 0}
                  title={p.agents > 0 ? "In use by AI agents" : "Remove"}
                  onClick={async () => {
                    try {
                      await api(`/sa/ai-providers/${p._id}`, { method: "DELETE" });
                      loadProviders();
                    } catch (e: any) {
                      toast("err", e.message);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {perm.create && (
          <button className="mt-3 text-sm font-semibold text-hive-700" onClick={() => (setManage(false), setProvForm({ ...NEW_PROVIDER }))}>
            + Add provider
          </button>
        )}
      </Modal>
    </>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Upload, FileText, X, MessageSquare, Send, BarChart3 } from "lucide-react";
import { ModelCharges, UsageModal } from "@/components/AiUsage";
import { EndpointsTab } from "@/components/AiEndpoints";
import { Tabs } from "@/components/Logs";
import { toText } from "@shared/text";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NO_EXTENSIONS } from "@/components/Assistant";
import { api } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Empty, Spinner, Confirm, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";
import { DataAccessPicker, dataAccessLabel, type DataTable } from "@/components/DataAccessPicker";

const ACCEPT = ".csv,.xlsx,.zip,.txt,.json,.docx,.pdf,.md";

export default function CompanyAiAgents() {
  const [list, setList] = useState<any[] | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [del, setDel] = useState<any>(null);
  const [chat, setChat] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [pick, setTab] = useState<"models" | "endpoint">("models");
  const [epOpen, setEpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Models and Endpoint are separate sub-modules in Role Management.
  const modelsPerm = usePerm("ai_agents:models"), endpointPerm = usePerm("ai_agents:endpoint");
  const tabs = [modelsPerm.read && { key: "models" as const, label: "Models" }, endpointPerm.read && { key: "endpoint" as const, label: "Endpoint" }].filter(Boolean) as { key: "models" | "endpoint"; label: string }[];
  const tab = (tabs.some((t) => t.key === pick) ? pick : tabs[0]?.key) || "models";
  const perm = tab === "models" ? modelsPerm : endpointPerm;
  const toast = useToast();
  const [storage, setStorage] = useState<{ brain: string } | null>(null);
  const [tables, setTables] = useState<DataTable[] | null>(null);
  const [me, setMe] = useState<string>("");
  const load = () => api("/co/ai-agents").then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
    api("/co/ai-agents/models").then(setModels);
    api("/co/storage").then(setStorage).catch(() => undefined);
    api("/co/ai-agents/data-tables").then(setTables).catch(() => setTables([]));
    api("/auth/me").then((m: any) => setMe(m?.companyName || m?.company?.name || "")).catch(() => undefined);
  }, []);

  function openForm(a?: any) {
    setFiles([]);
    setRemove([]);
    const allTables = (tables || []).map((t) => t.key);
    // older agents had no explicit choice (they could read every table) — show that as all ticked
    setForm(a ? { ...a, isAssistant: !!a.isAssistant, agentId: a.agentId?._id || a.agentId, prompts: a.prompts?.length ? a.prompts : [{ title: "", text: "" }], dataAccess: Array.isArray(a.dataAccess) ? a.dataAccess.filter((k: string) => allTables.includes(k)) : allTables } : { agentId: models[0]?._id || "", name: "", purpose: "", systemPrompt: "", prompts: [{ title: "", text: "" }], knowledge: [], isAssistant: !list?.some((x: any) => x.isAssistant), dataAccess: allTables });
  }

  async function save() {
    setBusy(true);
    try {
      const fd = new FormData();
      const { agentId, name, purpose, systemPrompt, prompts } = form;
      fd.append("data", JSON.stringify({ agentId, name, purpose, systemPrompt, isAssistant: !!form.isAssistant, ...(tables ? { dataAccess: form.dataAccess || [] } : {}), prompts: prompts.filter((p: any) => p.title || p.text), removeKeys: remove }));
      files.forEach((f) => fd.append("files", f));
      if (form._id) await api(`/co/ai-agents/${form._id}`, { method: "PUT", form: fd });
      else await api("/co/ai-agents", { form: fd });
      toast("ok", "Agent saved");
      setForm(null);
      load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  const credits = (id: string) => models.find((m) => m._id === id);

  return (
    <>
      <PageHeader
        title="AI Agent"
        subtitle={tab === "models" ? "Build assistants on the AI models allocated to you, grounded in your own price lists, FAQs and SOPs." : "Let your website chatbot, WhatsApp bot or other systems ask your AI agent questions over HTTPS."}
        actions={
          perm.create && (
            <Btn onClick={() => (tab === "models" ? openForm() : setEpOpen(true))}>
              <Plus className="h-4 w-4" /> Create
            </Btn>
          )
        }
      />
      {tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs} />}
      {tab === "endpoint" ? (
        <EndpointsTab agents={list || []} models={models} perm={perm} open={epOpen} setOpen={setEpOpen} />
      ) : (
        <>
      {list && !models.length && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>No AI models are offered yet.</b> You can create agents and upload knowledge files now; chat and the floating Assistant start working as soon as
          the Super Admin adds an AI model (Super Admin › AI Agents).
        </div>
      )}
      {models.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-3">
          {models.map((m) => (
            <div key={m._id} className="card flex items-center gap-3 px-4 py-3">
              <span className="text-sm font-semibold">{m.name}</span>
              <span className="text-xs text-ink-500">₹{m.companyRate}/credit</span>
              <Badge color={m.remaining > m.credits * 0.1 ? "green" : "red"}>
                {m.remaining.toLocaleString("en-IN")} / {m.credits.toLocaleString("en-IN")} credits
              </Badge>
            </div>
          ))}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              {["Agent name", "AI model", "Purpose", "Data access", "Knowledge base", "Prompts", "Action"].map((h) => (
                <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list?.map((a) => (
              <tr key={a._id} className="hover:bg-hive-50/40">
                <td className="td font-semibold">
                  {a.name} {a.isAssistant && <Badge color="green">Assistant</Badge>}
                </td>
                <td className="td">
                  {a.agentId ? (
                    <>
                      {a.agentId.name} <span className="mono text-ink-400">{a.agentId.llmVersion}</span>
                    </>
                  ) : (
                    <Badge color="honey">No model yet</Badge>
                  )}
                </td>
                <td className="td max-w-[260px]">
                  <p className="line-clamp-2 text-ink-700">{a.purpose || "—"}</p>
                </td>
                <td className="td max-w-[200px]">
                  <span className="line-clamp-2 text-sm text-ink-700">{dataAccessLabel(a, tables)}</span>
                </td>
                <td className="td">{a.knowledge.length} file(s)</td>
                <td className="td">{a.prompts.length}</td>
                <td className="td whitespace-nowrap text-right">
                  <button className="btn-ghost" onClick={() => setUsage(a)} title="Usage history, cost and credits left">
                    <BarChart3 className="h-4 w-4" /> Usage
                  </button>
                  <button className="btn-ghost" onClick={() => setChat({ agent: a, messages: [], input: "", busy: false, usage: null })}>
                    <MessageSquare className="h-4 w-4" /> Test
                  </button>
                  {perm.update && (
                    <button className="btn-ghost" aria-label="Edit" onClick={() => openForm(a)}>
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
        {list && !list.length && <Empty title="No agents yet" hint={models.length ? "Create an agent — e.g. a package recommender that answers from your test price list." : "No AI models have been allocated to your company yet. Contact your administrator."} />}
      </div>

        </>
      )}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? "Edit AI agent" : "Create AI agent"}
        size="xl"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Btn>
            <Btn loading={busy} onClick={save} disabled={!form?.name}>
              Save
            </Btn>
          </>
        }
      >
        {form && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <Field label="AI model">
                <select className="input" value={form.agentId || ""} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
                  {!models.length ? <option value="">No AI model offered yet — pick later</option> : <option value="">Select an AI model…</option>}
                  {models.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name} · ₹{m.companyRate}/credit
                    </option>
                  ))}
                </select>
                <ModelCharges model={models.find((m) => m._id === form.agentId)} />
              </Field>
              <label className="flex items-start gap-3 rounded-2xl border border-hive-200 bg-hive-50/70 p-3.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={!!form.isAssistant} onChange={(e) => setForm({ ...form, isAssistant: e.target.checked })} />
                <span className="text-sm">
                  <b>Use as the company assistant</b>
                  <span className="block text-ink-500">Shows a floating button with your logo on every screen. It answers from the data tables chosen under Data access (read-only) and uses this agent’s credits.</span>
                </span>
              </label>
              <Field label="Agent name" required>
                <input className="input" placeholder="e.g. Health Package Advisor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Purpose">
                <textarea className="input min-h-[80px]" placeholder="Answers patient questions about tests, prices and home collection, then books a call-back." value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </Field>
              <div>
                <p className="label">Knowledge base</p>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-hive-200 bg-hive-50/50 px-4 py-6 text-center hover:bg-hive-50">
                  <Upload className="mb-1.5 h-5 w-5 text-hive-600" />
                  <span className="text-sm font-semibold">Add files</span>
                  <span className="text-xs text-ink-500">csv, Excel, zip, .txt, json, .docx, .pdf · 4 MB each</span>
                  {storage && <span className="mt-1 text-[11px] text-ink-400">Saved to AWS S3 › <span className="mono">{storage.brain}</span></span>}
                  <input type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])])} />
                </label>
                <ul className="mt-2 space-y-1.5">
                  {form.knowledge
                    ?.filter((k: any) => !remove.includes(k.key))
                    .map((k: any) => (
                      <li key={k.key} className="flex items-center gap-2 rounded-lg bg-hive-50/70 px-3 py-1.5 text-sm">
                        <FileText className="h-4 w-4 text-hive-600" />
                        <span className="flex-1 truncate">{k.fileName}</span>
                        <span className="text-xs text-ink-400">{(k.chars / 1000).toFixed(1)}k chars</span>
                        <button aria-label="Remove" onClick={() => setRemove([...remove, k.key])}>
                          <X className="h-4 w-4 text-ink-400 hover:text-red-600" />
                        </button>
                      </li>
                    ))}
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-lg bg-honey-100/60 px-3 py-1.5 text-sm">
                      <Upload className="h-4 w-4 text-honey-700" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-ink-400">new</span>
                      <button aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                        <X className="h-4 w-4 text-ink-400 hover:text-red-600" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="space-y-4">
              <Field label="System prompt" hint="Tone, rules and boundaries">
                <textarea className="input min-h-[120px]" placeholder="You are a friendly advisor for a diagnostic centre. Never give medical diagnoses. Quote prices only from the knowledge base." value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} />
              </Field>
              <div>
                <p className="label">Prompts</p>
                <div className="space-y-3">
                  {form.prompts.map((p: any, i: number) => (
                    <div key={i} className="rounded-xl border border-ink-400/15 p-3">
                      <div className="flex gap-2">
                        <input className="input" placeholder="Title, e.g. Qualify lead" value={p.title} onChange={(e) => setForm({ ...form, prompts: form.prompts.map((x: any, j: number) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                        <button className="btn-ghost" aria-label="Remove prompt" onClick={() => setForm({ ...form, prompts: form.prompts.filter((_: any, j: number) => j !== i) })}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <textarea className="input mt-2 min-h-[70px]" placeholder="Ask for age, preferred date and whether home collection is needed." value={p.text} onChange={(e) => setForm({ ...form, prompts: form.prompts.map((x: any, j: number) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                    </div>
                  ))}
                </div>
                <button className="mt-2 text-sm font-semibold text-hive-700" onClick={() => setForm({ ...form, prompts: [...form.prompts, { title: "", text: "" }] })}>
                  + Add prompt
                </button>
              </div>
              <DataAccessPicker tables={tables} value={form.dataAccess || []} onChange={(v) => setForm({ ...form, dataAccess: v })} company={me} />
            </div>
          </div>
        )}
      </Modal>

      <UsageModal agent={usage} onClose={() => { setUsage(null); api("/co/ai-agents/models").then(setModels); }} />
      <ChatTester state={chat} setState={setChat} onUsage={() => api("/co/ai-agents/models").then(setModels)} credits={chat ? credits(chat.agent.agentId?._id) : null} />

      <Confirm
        open={!!del}
        danger
        title="Delete agent?"
        body={`${del?.name} and its knowledge-base files will be deleted.`}
        confirmLabel="Delete"
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await api(`/co/ai-agents/${del._id}`, { method: "DELETE" });
          load();
        }}
      />
    </>
  );
}

function ChatTester({ state, setState, onUsage, credits }: { state: any; setState: (s: any) => void; onUsage: () => void; credits: any }) {
  const end = useRef<HTMLDivElement>(null);
  const toast = useToast();
  // Block body on purpose: newer Chrome returns a Promise from scrollIntoView, and React would call it as the cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state?.messages?.length]);
  if (!state) return null;
  async function send() {
    const messages = [...state.messages, { role: "user", content: state.input }];
    setState({ ...state, messages, input: "", busy: true });
    try {
      const r = await api(`/co/ai-agents/${state.agent._id}/chat`, { body: { messages } });
      const text = toText(r?.text);
      setState({ ...state, messages: [...messages, { role: "assistant", content: text || "(empty reply)" }], input: "", busy: false, usage: r?.usage || null });
      onUsage();
    } catch (e: any) {
      toast("err", e.message);
      setState({ ...state, messages, input: "", busy: false });
    }
  }
  return (
    <Modal open onClose={() => setState(null)} title={`Test · ${state.agent.name}`} size="md">
      <div className="flex h-[55vh] flex-col">
        <ErrorBoundary where="agent-test-chat" onReset={() => setState({ ...state, messages: [], busy: false })}>
        <div translate="no" className="notranslate flex-1 space-y-3 overflow-y-auto pr-1">
          {!state.messages.length && <p className="py-10 text-center text-sm text-ink-400">Ask something a customer would ask.</p>}
          {state.messages.map((m: any, i: number) => (
            <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "ml-auto bg-hive-700 text-white" : "bg-hive-50 text-ink-900"}`}>
              {toText(m.content)}
            </div>
          ))}
          {state.busy && <Spinner className="h-5 w-5 text-hive-600" />}
          <div ref={end} />
        </div>
        </ErrorBoundary>
        <p className="py-2 text-xs text-ink-400">{state.usage ? `Last reply: ${state.usage.credits ?? 0} credits · ${state.usage.remaining ?? "—"} left` : credits ? `${credits.remaining} credits left` : ""}</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (state.input.trim() && !state.busy) send();
          }}
        >
          <input {...NO_EXTENSIONS} className="input" value={state.input} onChange={(e) => setState({ ...state, input: e.target.value })} placeholder="Type a message" />
          <Btn type="submit" disabled={!state.input.trim() || state.busy} aria-label="Send">
            <Send className="h-4 w-4" />
          </Btn>
        </form>
      </div>
    </Modal>
  );
}

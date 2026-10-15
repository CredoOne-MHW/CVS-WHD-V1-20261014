"use client";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, KeyRound, Send, Database, ShieldCheck, Globe2, Copy, Check, FlaskConical } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Modal, Field, Btn, Badge, Empty, Spinner, Confirm, useToast } from "./ui";
import { NO_EXTENSIONS } from "./Assistant";

const ACCESS: Record<string, { label: string; hint: string }> = {
  aggregate: { label: "Knowledge + company totals", hint: "Answers from the knowledge base and totals/breakdowns of your data (counts, sums, trends). Never names, phones or emails — safe for public chatbots." },
  full: { label: "Knowledge + full read-only data", hint: "Can also list individual records. Use only for internal systems you trust." },
  none: { label: "Knowledge base only", hint: "No database access — answers only from the agent’s knowledge files and instructions." },
};

function CopyText({ text, mono = true }: { text: string; mono?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-1 rounded-xl border border-ink-400/20 bg-hive-50/50 pl-3">
      <code className={`${mono ? "mono" : ""} flex-1 overflow-x-auto whitespace-nowrap py-2.5 text-[12.5px]`}>{text}</code>
      <button
        type="button"
        className="btn-ghost shrink-0"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }}
      >
        {ok ? <Check className="h-4 w-4 text-hive-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Company Admin › AI Agent › Endpoint — HTTPS endpoints that external systems call with a user's question. */
export function EndpointsTab({ agents, models, perm, open, setOpen }: { agents: any[]; models: any[]; perm: any; open: boolean; setOpen: (v: boolean) => void }) {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [shown, setShown] = useState<{ ep: any; key: string } | null>(null);
  const [del, setDel] = useState<any>(null);
  const [guide, setGuide] = useState<any>(null);
  const [test, setTest] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = () => api("/co/ai-endpoints", { fresh: true }).then(setData);
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (open) {
      setForm({ name: "", mode: agents.length ? "agent" : "model", companyAgentId: agents[0]?._id || "", agentId: models[0]?._id || "", instructions: "", dataAccess: "aggregate", allowedOrigins: "", rateLimitPerMin: 60, active: true });
      setOpen(false);
    }
  }, [open]);

  async function save() {
    setBusy(true);
    try {
      const body = { ...form, allowedOrigins: String(form.allowedOrigins || "").split(/[\s,]+/).filter(Boolean), rateLimitPerMin: Number(form.rateLimitPerMin) || 60 };
      if (body.mode === "agent") body.agentId = null;
      else body.companyAgentId = null;
      for (const k of ["_id", "companyId", "keyPrefix", "stats", "createdAt", "updatedAt", "__v", "url", "agentName", "modelName"]) delete body[k];
      if (form._id) {
        await api(`/co/ai-endpoints/${form._id}`, { method: "PUT", body });
        toast("ok", "Endpoint updated");
      } else {
        const r = await api("/co/ai-endpoints", { body });
        setShown({ ep: r, key: r.key });
      }
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
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-hive-200 bg-hive-50/60 px-4 py-3 text-sm text-hive-900">
        <Database className="h-4 w-4" />
        Endpoints answer from your knowledge base and your company database <b className="mono">{data?.db || "…"}</b> only — read-only, never another company’s data.
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              {["Endpoint", "Answers with", "Data access", "Key", "Calls", "Status", "Action"].map((h) => (
                <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((e: any) => (
              <tr key={e._id} className="hover:bg-hive-50/40">
                <td className="td font-semibold">
                  {e.name}
                  {e.allowedOrigins?.length > 0 && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-ink-400">
                      <Globe2 className="h-3 w-3" /> {e.allowedOrigins.length} website(s)
                    </span>
                  )}
                </td>
                <td className="td">{e.mode === "agent" ? <>Agent · {e.agentName || "—"}</> : <>Model · {e.modelName || "—"}</>}</td>
                <td className="td">
                  <Badge color={e.dataAccess === "full" ? "honey" : e.dataAccess === "none" ? "gray" : "green"}>{ACCESS[e.dataAccess]?.label}</Badge>
                </td>
                <td className="td mono text-xs">{e.keyPrefix}…</td>
                <td className="td tabular-nums text-sm">
                  {e.stats?.calls || 0}
                  <span className="block text-xs text-ink-400">{e.stats?.lastAt ? fmtDate(e.stats.lastAt) : "never"}</span>
                </td>
                <td className="td">
                  <Badge color={e.active ? "green" : "gray"}>{e.active ? "Live" : "Off"}</Badge>
                </td>
                <td className="td whitespace-nowrap text-right">
                  <button className="btn-ghost" onClick={() => setGuide(e)}>
                    <Send className="h-4 w-4" /> Integrate
                  </button>
                  <button className="btn-ghost" onClick={() => setTest({ ep: e, q: "", msgs: [], busy: false })}>
                    <FlaskConical className="h-4 w-4" /> Test
                  </button>
                  {perm.update && (
                    <button className="btn-ghost" aria-label="Edit" onClick={() => setForm({ ...e, allowedOrigins: (e.allowedOrigins || []).join("\n"), companyAgentId: e.companyAgentId || "", agentId: e.agentId || "" })}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {perm.update && (
                    <button
                      className="btn-ghost"
                      aria-label="Rotate key"
                      onClick={async () => {
                        const r = await api(`/co/ai-endpoints/${e._id}/rotate`, { method: "POST" });
                        setShown({ ep: e, key: r.key });
                        load();
                      }}
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                  )}
                  {perm.delete && (
                    <button className="btn-ghost text-red-600" aria-label="Delete" onClick={() => setDel(e)}>
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
        {data && !data.items.length && <Empty title="No endpoints yet" hint="Create an endpoint to let your website chatbot, WhatsApp bot or another app ask your AI agent questions." />}
      </div>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? "Edit endpoint" : "Create endpoint"}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Btn>
            <Btn loading={busy} disabled={!form?.name || (form?.mode === "agent" ? !form?.companyAgentId : !form?.agentId)} onClick={save}>
              Save
            </Btn>
          </>
        }
      >
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Endpoint name" required className="sm:col-span-2">
              <input className="input" placeholder="e.g. Website chatbot" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <p className="label">Answer with</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["agent", "An existing AI Agent", "Uses its model, instructions and knowledge files"],
                  ["model", "A new endpoint on a model", "Pick an allocated model and write instructions"],
                ].map(([k, t, d]) => (
                  <button key={k} type="button" onClick={() => setForm({ ...form, mode: k })} className={`rounded-2xl border p-3 text-left ${form.mode === k ? "border-hive-600 bg-hive-50 ring-1 ring-hive-600" : "border-ink-400/20 hover:bg-hive-50/50"}`}>
                    <p className="text-sm font-semibold">{t}</p>
                    <p className="text-xs text-ink-500">{d}</p>
                  </button>
                ))}
              </div>
            </div>
            {form.mode === "agent" ? (
              <Field label="AI Agent" required className="sm:col-span-2">
                <select className="input" value={form.companyAgentId} onChange={(e) => setForm({ ...form, companyAgentId: e.target.value })}>
                  {!agents.length && <option value="">Create an AI agent in the Models tab first</option>}
                  {agents.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name}
                      {a.agentId?.name ? ` · ${a.agentId.name}` : " · no model"}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="AI model" required className="sm:col-span-2">
                <select className="input" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
                  {!models.length && <option value="">No model allocated yet</option>}
                  {models.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name} · ₹{m.companyRate}/credit · {Number(m.remaining).toLocaleString("en-IN")} credits left
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={form.mode === "agent" ? "Extra instructions for this endpoint" : "Instructions"} className="sm:col-span-2">
              <textarea rows={3} className="input" placeholder="You are the booking assistant on our website. Keep answers under 80 words. Offer a call-back when unsure." value={form.instructions || ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <p className="label">Data access</p>
              <div className="grid gap-2">
                {Object.entries(ACCESS).map(([k, v]) => (
                  <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${form.dataAccess === k ? "border-hive-600 bg-hive-50" : "border-ink-400/20"}`}>
                    <input type="radio" name="access" className="mt-1 accent-hive-700" checked={form.dataAccess === k} onChange={() => setForm({ ...form, dataAccess: k })} />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {k !== "none" && <ShieldCheck className="h-3.5 w-3.5 text-hive-700" />} {v.label}
                      </span>
                      <span className="text-xs text-ink-500">{v.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <Field label="Allowed websites (browser calls)" className="sm:col-span-2" hint="One per line, e.g. https://www.wellnesshive.in. Leave empty for server-to-server use only (recommended — keep the key on your server).">
              <textarea rows={2} className="input mono text-xs" value={form.allowedOrigins} onChange={(e) => setForm({ ...form, allowedOrigins: e.target.value })} />
            </Field>
            <Field label="Rate limit (requests / minute)">
              <input type="number" min={1} max={600} className="input" value={form.rateLimitPerMin} onChange={(e) => setForm({ ...form, rateLimitPerMin: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-3 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Live
            </label>
          </div>
        )}
      </Modal>

      <Modal open={!!shown} onClose={() => setShown(null)} title="Your endpoint key" size="md">
        {shown && (
          <div className="space-y-3">
            <p className="rounded-xl border border-honey-300 bg-honey-100/60 p-3 text-sm">Copy this key now — it is shown only once. Anyone with it can ask your endpoint questions (and spend your AI credits).</p>
            <CopyText text={shown.key} />
            <Btn
              variant="secondary"
              onClick={() => {
                setGuide({ ...shown.ep, _key: shown.key });
                setShown(null);
              }}
            >
              <Send className="h-4 w-4" /> How to integrate
            </Btn>
          </div>
        )}
      </Modal>

      <Modal open={!!guide} onClose={() => setGuide(null)} title={`Integrate · ${guide?.name || ""}`} size="lg">
        {guide && <IntegrationGuide ep={guide} />}
      </Modal>

      <Modal open={!!test} onClose={() => setTest(null)} title={`Test · ${test?.ep?.name || ""}`} size="md">
        {test && (
          <div className="flex h-[55vh] flex-col">
            <div translate="no" className="notranslate flex-1 space-y-3 overflow-y-auto pr-1">
              {!test.msgs.length && <p className="py-10 text-center text-sm text-ink-400">Ask what an outside user would ask — e.g. “What does a full body checkup include?”</p>}
              {test.msgs.map((m: any, i: number) => (
                <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "ml-auto bg-hive-700 text-white" : "bg-hive-50 text-ink-900"}`}>
                  {String(m.content)}
                </div>
              ))}
              {test.busy && <Spinner className="h-5 w-5 text-hive-600" />}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const q = test.q.trim();
                if (!q || test.busy) return;
                const history = test.msgs;
                setTest({ ...test, q: "", busy: true, msgs: [...history, { role: "user", content: q }] });
                try {
                  const r = await api(`/co/ai-endpoints/${test.ep._id}/test`, { body: { question: q, history } });
                  setTest((t: any) => t && { ...t, busy: false, msgs: [...t.msgs, { role: "assistant", content: typeof r.answer === "string" ? r.answer : JSON.stringify(r.answer) }] });
                } catch (err: any) {
                  setTest((t: any) => t && { ...t, busy: false, msgs: [...t.msgs, { role: "assistant", content: `⚠️ ${err.message}` }] });
                }
              }}
            >
              <input {...NO_EXTENSIONS} className="input" value={test.q} onChange={(e) => setTest({ ...test, q: e.target.value })} placeholder="Type a question" />
              <Btn type="submit" disabled={!test.q.trim() || test.busy} aria-label="Send">
                <Send className="h-4 w-4" />
              </Btn>
            </form>
          </div>
        )}
      </Modal>

      <Confirm
        open={!!del}
        title="Delete this endpoint?"
        body="Systems using its key stop working immediately."
        confirmLabel="Delete"
        danger
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await api(`/co/ai-endpoints/${del._id}`, { method: "DELETE" });
          toast("ok", "Endpoint deleted");
          load();
        }}
      />
    </>
  );
}

function IntegrationGuide({ ep }: { ep: any }) {
  const key = ep._key || "ep_live_YOUR_KEY";
  const curl = `curl -X POST '${ep.url}' \\\n  -H 'Authorization: Bearer ${key}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"question": "Do you offer home sample collection in Salt Lake?"}'`;
  const node = `const r = await fetch("${ep.url}", {\n  method: "POST",\n  headers: { Authorization: "Bearer " + process.env.LMS_ENDPOINT_KEY, "Content-Type": "application/json" },\n  body: JSON.stringify({\n    question: userMessage,\n    history // optional: [{ role: "user" | "assistant", content: "..." }] — last 10 turns\n  })\n});\nconst { answer } = await r.json();`;
  const py = `import os, requests\nr = requests.post("${ep.url}",\n    headers={"Authorization": f"Bearer {os.environ['LMS_ENDPOINT_KEY']}"},\n    json={"question": user_message}, timeout=60)\nprint(r.json()["answer"])`;
  const steps = [
    { t: "Keep the key on your server", d: "Store it as an environment variable (e.g. LMS_ENDPOINT_KEY). Never put it in a public web page unless you also add that website under Allowed websites." },
    { t: "Send the user’s question", d: "POST JSON with the question. Send the previous turns as history to keep context.", code: curl },
    { t: "Use the answer", d: "The response is { \"answer\": \"…\", \"usage\": { credits, remaining } }. Errors: 401 wrong key · 402 credits exhausted · 403 endpoint off / website not allowed · 429 rate limit.", code: `{\n  "answer": "Yes — we collect samples at home across Salt Lake, 7 AM to 11 AM…",\n  "usage": { "credits": 1.24, "remaining": 98.7 }\n}` },
    { t: "Node.js / Next.js", d: "Server-side call:", code: node },
    { t: "Python", d: "", code: py },
    { t: "WhatsApp or website chatbot", d: "In your bot (Interakt, AiSensy, WATI, Botpress, Voiceflow…), add an HTTP/API step that POSTs the incoming message as question and replies with answer." },
  ];
  return (
    <div className="space-y-4">
      <Field label="Endpoint URL">
        <CopyText text={ep.url} />
      </Field>
      <ol className="relative space-y-4 border-l-2 border-hive-100 pl-6">
        {steps.map((s, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[35px] grid h-7 w-7 place-items-center rounded-full bg-hive-700 text-xs font-bold text-white ring-4 ring-white">{i + 1}</span>
            <p className="font-semibold">{s.t}</p>
            {s.d && <p className="text-sm text-ink-700">{s.d}</p>}
            {s.code && <pre className="mono mt-2 overflow-x-auto whitespace-pre rounded-xl bg-[#0f1a0d] p-3 text-[12px] leading-relaxed text-[#d7f0cc]">{s.code}</pre>}
          </li>
        ))}
      </ol>
    </div>
  );
}

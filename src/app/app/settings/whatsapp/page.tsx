"use client";
import { useEffect, useMemo, useState } from "react";
import { Send, Upload, Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import { PageHeader, Btn, Field, Badge, useToast } from "@/components/ui";
import { WebhookBoard } from "@/components/Webhooks";
import { Tabs } from "@/components/Logs";
import { usePerm } from "@/components/Shell";
import { LEAD_STATUSES } from "@shared/constants";

export default function WhatsAppSettings() {
  const [tab, setTab] = useState<"hooks" | "post">("hooks");
  return (
    <>
      <PageHeader title="WhatsApp Webhook" subtitle="Connect your WhatsApp API, choose which events send messages, and post to leads." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "hooks", label: "Webhooks" }, { key: "post", label: "Post" }]} />
      {tab === "hooks" ? <WebhookBoard base="/co" createAlign="right" allowEventTypes /> : <Post />}
    </>
  );
}

/** Post: pick existing leads (or upload a sheet), choose a webhook, send. */
function Post() {
  const [hooks, setHooks] = useState<any[]>([]);
  const [webhookId, setWebhookId] = useState("");
  const [message, setMessage] = useState("Hi {{name}},\n");
  const [mode, setMode] = useState<"leads" | "upload">("leads");
  const [f, setF] = useState({ q: "", status: "", source: "" });
  const [leads, setLeads] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const perm = usePerm("wa_webhooks");
  const toast = useToast();

  useEffect(() => {
    api("/co/webhooks").then((r) => {
      const active = r.items.filter((h: any) => h.active);
      setHooks(active);
      setWebhookId(active.find((h: any) => h.event === "broadcast")?._id || active[0]?._id || "");
    });
  }, []);
  useEffect(() => {
    if (mode === "leads") api(`/co/leads${qs({ ...f, limit: 200 })}`).then((r) => setLeads(r.items));
  }, [f, mode]);

  const withPhone = useMemo(() => leads.filter((l) => l.whatsapp || l.phone), [leads]);
  const allSel = withPhone.length > 0 && withPhone.every((l) => sel.has(l._id));

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("data", JSON.stringify({ webhookId, message, leadIds: mode === "leads" ? [...sel] : undefined, saveAsLeads: mode === "upload" ? save : undefined }));
      if (mode === "upload" && file) fd.append("file", file);
      const r = await api("/co/wa-post", { form: fd });
      setResult(r);
      toast(r.failed ? "err" : "ok", `${r.ok} sent, ${r.failed} failed`);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
          <Tabs value={mode} onChange={setMode} tabs={[{ key: "leads", label: "Existing leads" }, { key: "upload", label: "Upload Excel / CSV" }]} />
        </div>
        {mode === "leads" ? (
          <>
            <div className="flex flex-wrap gap-3 border-b border-ink-400/15 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input className="input w-60 pl-9" placeholder="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
              </div>
              <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
                <option value="">All statuses</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <span className="self-center text-sm text-ink-500">{sel.size} selected</span>
            </div>
            <div className="max-h-[540px] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0">
                  <tr>
                    <th className="th w-10">
                      <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={allSel} onChange={(e) => setSel(e.target.checked ? new Set(withPhone.map((l) => l._id)) : new Set())} aria-label="Select all" />
                    </th>
                    {["Name", "WhatsApp", "Status", "Consent"].map((h) => (
                      <th key={h} className="th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l._id} className="hover:bg-hive-50/40">
                      <td className="td">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-hive-700"
                          disabled={!l.whatsapp && !l.phone}
                          checked={sel.has(l._id)}
                          onChange={(e) => {
                            const s = new Set(sel);
                            e.target.checked ? s.add(l._id) : s.delete(l._id);
                            setSel(s);
                          }}
                          aria-label={`Select ${l.name}`}
                        />
                      </td>
                      <td className="td font-semibold">{l.name || "—"}</td>
                      <td className="td mono">{l.whatsapp || l.phone || "—"}</td>
                      <td className="td">
                        <Badge>{l.status}</Badge>
                      </td>
                      <td className="td">{l.consent?.whatsapp ? <Badge color="green">Yes</Badge> : <span className="text-xs text-ink-400">unknown</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="space-y-4 p-5">
            <div className="flex gap-2">
              <a className="btn-secondary" href="/api/co/leads/template.xlsx">
                Sample .xlsx
              </a>
              <a className="btn-secondary" href="/api/co/leads/template.csv">
                Sample .csv
              </a>
            </div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-hive-200 bg-hive-50/50 px-4 py-12 text-center hover:bg-hive-50">
              <Upload className="mb-2 h-6 w-6 text-hive-600" />
              <span className="text-sm font-semibold">{file ? file.name : "Choose .xlsx or .csv with Name and WhatsApp No columns"}</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={save} onChange={(e) => setSave(e.target.checked)} />
              Also save these contacts as leads (de-duplicated)
            </label>
          </div>
        )}
      </div>

      <div className="card h-fit space-y-4 p-5">
        <Field label="Webhook" required hint="Only active webhooks are listed">
          <select className="input" value={webhookId} onChange={(e) => setWebhookId(e.target.value)}>
            {!hooks.length && <option value="">No active webhooks</option>}
            {hooks.map((h) => (
              <option key={h._id} value={h._id}>
                {h.name} · {h.event}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Message" required hint="{{name}} is replaced per recipient. Long messages are split per the webhook's max characters.">
          <textarea className="input min-h-[200px]" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <p className="rounded-xl bg-honey-100/70 p-3 text-xs text-ink-700">Only message people who agreed to hear from you on WhatsApp. Business-initiated messages need an approved template on your WhatsApp provider.</p>
        {perm.update && (
          <Btn className="w-full" loading={busy} disabled={!webhookId || !message.trim() || (mode === "leads" ? !sel.size : !file)} onClick={send}>
            <Send className="h-4 w-4" /> Send {mode === "leads" && sel.size ? `to ${sel.size}` : ""}
          </Btn>
        )}
        {result && (
          <p className="text-sm font-semibold text-ink-700">
            {result.recipients} recipients · {result.ok} sent · {result.failed} failed. Details in WhatsApp Logs.
          </p>
        )}
      </div>
    </div>
  );
}

"use client";
import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Info, PlugZap, Search } from "lucide-react";
import { GUIDES, fillGuide } from "@/lib/guides";
import { api } from "@/lib/api";
import { Field, Btn, useToast } from "./ui";

function CodeBlock({ code }: { code: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="group relative mt-2">
      <pre className="mono overflow-x-auto whitespace-pre rounded-xl bg-[#0f1a0d] p-3 pr-11 text-[12px] leading-relaxed text-[#d7f0cc]">{code}</pre>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }}
        className="absolute right-2 top-2 rounded-lg bg-white/10 p-1.5 text-white/80 hover:bg-white/20"
      >
        {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** Numbered setup steps for a connector type, filled with the live values of `c` when given. */
export function GuideSteps({ type, c, compact }: { type: string; c?: any; compact?: boolean }) {
  const g = GUIDES[type];
  const v = useMemo(() => ({ endpoint: c?.endpoint, secret: c?.secret || c?.secretMasked, verify: c?.verifyToken, form: c?.formUrl }), [c]);
  if (!g) return null;
  return (
    <div className="space-y-4">
      {!compact && <p className="text-sm text-ink-700">{g.summary}</p>}
      {g.note && (
        <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{g.note}</p>
        </div>
      )}
      <ol className="relative space-y-4 border-l-2 border-hive-100 pl-6">
        {g.steps.map((s, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[35px] grid h-7 w-7 place-items-center rounded-full bg-hive-700 text-xs font-bold text-white ring-4 ring-white">{i + 1}</span>
            <p className="font-semibold text-ink-900">{s.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-700">{fillGuide(s.body, v as any)}</p>
            {s.code && <CodeBlock code={fillGuide(s.code, v as any)} />}
          </li>
        ))}
      </ol>
      {g.mcp && (
        <div className="flex gap-2.5 rounded-xl border border-hive-200 bg-hive-50/70 p-3 text-[13px] text-hive-900">
          <PlugZap className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <b>Via MCP:</b> {g.mcp}
          </p>
        </div>
      )}
      {g.links?.length ? (
        <div className="flex flex-wrap gap-2">
          {g.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-ink-400/20 px-2.5 py-1.5 text-xs font-semibold text-hive-800 hover:bg-hive-50">
              {l.label} <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── settings for pull connectors ───────────── */

export const blankSearch = { provider: "serpapi", keywords: [] as string[], location: "", country: "in", language: "en", cx: "", sites: [] as string[], maxResults: 20, recentOnly: true };
export const blankMcp = { serverUrl: "", toolName: "", toolArgs: {} as any, itemsPath: "", defaultSource: "" };

export function GoogleSearchForm({ cfg, set, secret, setSecret, editing }: { cfg: any; set: (v: any) => void; secret: string; setSecret: (v: string) => void; editing?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Search provider" required>
        <select className="input" value={cfg.provider} onChange={(e) => set({ ...cfg, provider: e.target.value })}>
          <option value="serpapi">SerpAPI — Google results (recommended)</option>
          <option value="brave">Brave Search API</option>
          <option value="google_cse">Google Programmable Search (legacy, ends 1 Jan 2027)</option>
        </select>
      </Field>
      <Field label="API key" required={!editing} hint={editing ? "Leave blank to keep the saved key" : "Stored encrypted"}>
        <input className="input mono" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
      </Field>
      {cfg.provider === "google_cse" && (
        <Field label="Search engine ID (cx)" required className="sm:col-span-2">
          <input className="input mono" value={cfg.cx} onChange={(e) => set({ ...cfg, cx: e.target.value })} />
        </Field>
      )}
      <Field label="Keywords — one per line" required className="sm:col-span-2" hint="Phrase them the way customers write. Up to 25.">
        <textarea
          rows={5}
          className="input"
          placeholder={"need home sample collection Kolkata\nfull body checkup near Salt Lake\nthyroid test price Howrah"}
          value={(cfg.keywords || []).join("\n")}
          onChange={(e) => set({ ...cfg, keywords: e.target.value.split("\n").map((s) => s.trimStart()).slice(0, 25) })}
        />
      </Field>
      <Field label="City / region">
        <input className="input" placeholder="Kolkata, West Bengal, India" value={cfg.location} onChange={(e) => set({ ...cfg, location: e.target.value })} />
      </Field>
      <Field label="Results per keyword">
        <select className="input" value={cfg.maxResults} onChange={(e) => set({ ...cfg, maxResults: Number(e.target.value) })}>
          {[10, 20, 30, 50].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Only these sites (optional, one per line)" className="sm:col-span-2" hint="e.g. justdial.com, quora.com, reddit.com — leave empty for the whole web">
        <textarea rows={2} className="input mono" value={(cfg.sites || []).join("\n")} onChange={(e) => set({ ...cfg, sites: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10) })} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={cfg.recentOnly !== false} onChange={(e) => set({ ...cfg, recentOnly: e.target.checked })} /> Only pages from the last 24 hours (best for a daily run)
      </label>
    </div>
  );
}

export function McpForm({ cfg, set, secret, setSecret, connectorId, editing }: { cfg: any; set: (v: any) => void; secret: string; setSecret: (v: string) => void; connectorId?: string; editing?: boolean }) {
  const [tools, setTools] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [args, setArgs] = useState(JSON.stringify(cfg.toolArgs || {}, null, 2));
  const toast = useToast();
  const tool = tools?.find((t) => t.name === cfg.toolName);
  async function list() {
    setBusy(true);
    try {
      const r = await api("/co/integrations/mcp/tools", { body: { serverUrl: cfg.serverUrl, token: secret || undefined, connectorId } });
      setTools(r.tools);
      toast("ok", `${r.server?.name || "Server"}: ${r.tools.length} tool(s)`);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="MCP server URL" required className="sm:col-span-2">
        <input className="input mono" placeholder="https://mcp.zapier.com/api/mcp/s/…/mcp" value={cfg.serverUrl} onChange={(e) => set({ ...cfg, serverUrl: e.target.value })} />
      </Field>
      <Field label="Access token (if required)" hint={editing ? "Leave blank to keep the saved token" : "Stored encrypted"}>
        <input className="input mono" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
      </Field>
      <div className="flex items-end">
        <Btn type="button" variant="secondary" loading={busy} disabled={!cfg.serverUrl} onClick={list} className="w-full">
          <Search className="h-4 w-4" /> List tools
        </Btn>
      </div>
      <Field label="Tool" required className="sm:col-span-2">
        {tools ? (
          <select className="input" value={cfg.toolName} onChange={(e) => set({ ...cfg, toolName: e.target.value })}>
            <option value="">Select a tool…</option>
            {tools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.description ? ` — ${String(t.description).slice(0, 70)}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <input className="input mono" placeholder="List tools, or type the tool name" value={cfg.toolName} onChange={(e) => set({ ...cfg, toolName: e.target.value })} />
        )}
      </Field>
      {tool?.inputSchema?.properties && (
        <p className="rounded-xl bg-[#f7f8f6] px-3 py-2 text-xs text-ink-500 sm:col-span-2">
          Arguments: {Object.entries(tool.inputSchema.properties).map(([k, v]: any) => `${k}${(tool.inputSchema.required || []).includes(k) ? "*" : ""} (${v.type || "any"})`).join(", ")}
        </p>
      )}
      <Field label="Tool arguments (JSON)" className="sm:col-span-2">
        <textarea
          rows={4}
          className="input mono text-xs"
          value={args}
          onChange={(e) => {
            setArgs(e.target.value);
            try {
              set({ ...cfg, toolArgs: JSON.parse(e.target.value || "{}") });
            } catch {}
          }}
        />
      </Field>
      <Field label="Items path (optional)" hint="Where the records are in the result, e.g. results or data.items">
        <input className="input mono" value={cfg.itemsPath} onChange={(e) => set({ ...cfg, itemsPath: e.target.value })} />
      </Field>
      <Field label="Source label">
        <input className="input" placeholder="mcp" value={cfg.defaultSource} onChange={(e) => set({ ...cfg, defaultSource: e.target.value })} />
      </Field>
    </div>
  );
}

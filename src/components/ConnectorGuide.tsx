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
  const v = useMemo(() => ({ endpoint: c?.endpoint, pushUrl: c?.pushUrl || c?.pushUrlMasked, secret: c?.secret || c?.secretMasked, verify: c?.verifyToken, form: c?.formUrl }), [c]);
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

export const blankMcp = { serverUrl: "", toolName: "", toolArgs: {} as any, itemsPath: "", defaultSource: "" };
export const blankTradeIndia = { userId: "", profileId: "" };
export const blankGoogleAds = { campaignNames: {} as Record<string, string> };

/** IndiaMART: Pull API key (optional — Push works without it). */
export function IndiaMartForm({ platformKey, setPlatformKey, editing, masked }: { platformKey: string; setPlatformKey: (v: string) => void; editing?: boolean; masked?: string }) {
  return (
    <Field label="IndiaMART Pull API key (optional)" hint={editing && masked ? `Saved: ${masked} — paste a new key to replace it` : "Lead Manager → ⋮ → Import/Export Leads → Pull API → Generate Key. Enables the 15-minute safety-net fetch."}>
      <input className="input mono" type="password" autoComplete="off" value={platformKey} onChange={(e) => setPlatformKey(e.target.value)} placeholder="mRyx…" />
    </Field>
  );
}

/** TradeIndia: paste the API link (fills all three) or type User ID / Profile ID / Key. */
export function TradeIndiaForm({ cfg, set, platformKey, setPlatformKey, editing, masked }: { cfg: any; set: (v: any) => void; platformKey: string; setPlatformKey: (v: string) => void; editing?: boolean; masked?: string }) {
  const [link, setLink] = useState("");
  function fromLink(v: string) {
    setLink(v);
    try {
      const u = new URL(v.trim());
      const q = u.searchParams;
      const userId = q.get("userid") || q.get("user_id");
      const profileId = q.get("profile_id") || q.get("profileid");
      const key = q.get("key");
      if (userId || profileId) set({ ...cfg, userId: userId || cfg.userId, profileId: profileId || cfg.profileId });
      if (key) setPlatformKey(key);
    } catch {}
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Paste your TradeIndia API link" className="sm:col-span-2" hint="TradeIndia → your name → Inquiries & Contacts → My Inquiry API. Pasting fills the fields below.">
        <input className="input mono text-xs" value={link} onChange={(e) => fromLink(e.target.value)} placeholder="https://www.tradeindia.com/utils/my_inquiry.html?userid=…&profile_id=…&key=…" />
      </Field>
      <Field label="User ID" required>
        <input className="input mono" value={cfg.userId} onChange={(e) => set({ ...cfg, userId: e.target.value })} />
      </Field>
      <Field label="Profile ID" required>
        <input className="input mono" value={cfg.profileId} onChange={(e) => set({ ...cfg, profileId: e.target.value })} />
      </Field>
      <Field label="Key" required={!editing} className="sm:col-span-2" hint={editing && masked ? `Saved: ${masked} — paste a new key to replace it` : "Stored encrypted"}>
        <input className="input mono" type="password" autoComplete="off" value={platformKey} onChange={(e) => setPlatformKey(e.target.value)} />
      </Field>
    </div>
  );
}

/** Google Ads: optional campaign ID → name so leads show readable campaigns. */
export function GoogleAdsForm({ cfg, set }: { cfg: any; set: (v: any) => void }) {
  const [rows, setRows] = useState<{ id: string; name: string }[]>(() => [...Object.entries(cfg.campaignNames || {}).map(([id, name]) => ({ id, name: String(name) })), { id: "", name: "" }]);
  const commit = (next: { id: string; name: string }[]) => {
    const clean = next.filter((r) => r.id || r.name);
    setRows([...clean, { id: "", name: "" }]);
    set({ ...cfg, campaignNames: Object.fromEntries(clean.filter((r) => r.id && r.name).map((r) => [r.id, r.name])) });
  };
  return (
    <div className="space-y-2">
      <p className="label">Campaign names (optional)</p>
      <p className="text-xs text-ink-500">Google sends the campaign ID only. Map IDs to names (Google Ads → Campaigns → add the “Campaign ID” column).</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
          <input className="input mono" placeholder="Campaign ID e.g. 21456789012" value={r.id} onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, id: e.target.value.replace(/\D/g, "") } : x)))} />
          <input className="input" placeholder="Name e.g. Home collection – Kolkata" value={r.name} onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          {r.id || r.name ? (
            <button type="button" className="btn-ghost text-red-600" aria-label="Remove" onClick={() => commit(rows.filter((_, j) => j !== i))}>
              ×
            </button>
          ) : (
            <span className="w-9" />
          )}
        </div>
      ))}
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

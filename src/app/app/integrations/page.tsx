"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy as CopyIcon, Plus, Power, KeyRound, Trash2, BookOpen, Play, ExternalLink, EyeOff, FlaskConical } from "lucide-react";
import { GuideSteps, McpForm, blankMcp, IndiaMartForm, TradeIndiaForm, GoogleAdsForm, ShopifyForm, WooForm, ProspectForm, blankTradeIndia, blankGoogleAds, blankShopify, blankWoo, blankProspect } from "@/components/ConnectorGuide";
import { GUIDES } from "@/lib/guides";
import { icon } from "@/components/icons";
import { api, fmtDate } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Spinner, Confirm, JsonView, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";
import { Tabs } from "@/components/Logs";
import { SsoConnect } from "@/components/SsoConnect";
import { isSsoType, SSO_INFO, type SsoType } from "@shared/sso";

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
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
      {ok ? <Check className="h-4 w-4 text-hive-600" /> : <CopyIcon className="h-4 w-4" />}
    </button>
  );
}
/** QR generated in the browser — the form URL never leaves the app. Click to download a print-ready PNG. */
function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    import("qrcode").then((q) => q.toDataURL(text, { width: 800, margin: 2, color: { dark: "#1f3a1a" } }).then(setSrc));
  }, [text]);
  return src ? (
    <a href={src} download="campaign-qr.png" title="Download QR">
      <img alt="QR code for the campaign form" className="h-36 w-36 rounded-xl border" src={src} />
    </a>
  ) : (
    <div className="h-36 w-36 animate-pulse rounded-xl bg-hive-50" />
  );
}

function CopyRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex items-center gap-1 rounded-xl border border-ink-400/20 bg-hive-50/50 pl-3">
        <code className="mono flex-1 overflow-x-auto whitespace-nowrap py-2.5">{value}</code>
        <Copy text={value} />
      </div>
    </div>
  );
}

const HELP: Record<string, string> = {
  website_form: "REST API / webhook: POST each submission (JSON or form fields) to the endpoint with the x-api-key header or ?key=. name, phone, email, message and utm_* map automatically; keep the hidden _hp field as a bot trap.",
  rest_api: "POST JSON with header x-api-key. Send an Idempotency-Key header to make retries safe. Create one connector per system so attribution stays clean.",
  whatsapp: "REST API / webhook: Meta Cloud API → Callback URL = endpoint?key=<API key>, Verify token = the API key. BSPs send the x-api-key header. Every inbound chat becomes (or updates) a lead.",
  meta_leads: "Meta App → Webhooks → Page → leadgen. Callback = endpoint, Verify token = the token below. Paste a Page access token as the secret so lead details can be fetched.",
  google_ads: "Google Ads → Lead form asset → Webhook integration. Webhook URL = endpoint, Key = the secret.",
  email: "In SendGrid Inbound Parse / Mailgun Routes / Postmark inbound, forward to the endpoint with ?key=<secret>. Sender, subject and body become the lead.",
  telephony: "In Exotel / Knowlarity / Ozonetel, add a passthru / call webhook to the endpoint with ?key=<secret>. Caller number becomes the lead.",
  qr_campaign: "Print the QR code. It opens a hosted mobile form tagged with this connector's campaign.",
  partner: "Give each partner their own connector. Every lead is credited via the referral field and attribution history.",
};

const PULL_ONLY = ["mcp", "tradeindia", "web_prospect"]; // nothing to paste anywhere — we fetch
const HAS_PULL = ["mcp", "tradeindia", "indiamart", "woocommerce", "web_prospect"];
const HAS_SETTINGS = ["mcp", "tradeindia", "indiamart", "google_ads", "shopify", "woocommerce", "web_prospect"];
const PUSH_PLATFORMS = ["indiamart", "justdial", "sulekha", "shopify"]; // one self-authenticating Lead URL
const blankCfg = (t: string) =>
  t === "mcp" ? { ...blankMcp } : t === "tradeindia" ? { ...blankTradeIndia } : t === "google_ads" ? { ...blankGoogleAds } : t === "shopify" ? { ...blankShopify } : t === "woocommerce" ? { ...blankWoo } : t === "web_prospect" ? { ...blankProspect, sources: { ...blankProspect.sources } } : undefined;
/** Pull connectors whose fetch is optional (works by push without keys). */
const pullReady = (c: any) => (c.type === "indiamart" ? !!c.platformKeyMasked : c.type === "woocommerce" ? !!(c.platformKeyMasked && c.config?.consumerKey && c.config?.siteUrl) : true);

export default function Integrations() {
  const [data, setData] = useState<any>(null);
  const [create, setCreate] = useState<any>(null);
  const [guide, setGuide] = useState<{ type: string; label: string; c?: any } | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<any>(null);
  const [sso, setSso] = useState<{ type: SsoType; label: string; connectorId?: string } | null>(null);
  const perm = usePerm("integrations");
  const toast = useToast();
  const load = () => api("/co/integrations").then(setData);
  useEffect(() => {
    load();
    api("/co/sso/providers").then(setProviders).catch(() => setProviders({ enabled: {} }));
  }, []);

  if (!data)
    return (
      <div className="flex justify-center py-24 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  return (
    <>
      <PageHeader title="Integration" subtitle="Every channel feeds one pipeline. Each delivery is idempotent and failed deliveries retry automatically." />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {data.types.map((t: any) => {
          const Icon = icon(t.icon);
          const mine = data.connectors.filter((c: any) => c.type === t.type);
          if (t.hidden && !mine.length) return null; // retired setups show only while old connectors exist
          const local = t.inbound === "manual" || t.inbound === "upload";
          const isSso = t.inbound === "sso";
          const enabled = !isSso || !!providers?.enabled?.[t.provider];
          return (
            <div key={t.type} className="card flex flex-col p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-hive-50 p-2.5 text-hive-700">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold">{t.label}</h3>
                  <p className="mt-0.5 text-sm text-ink-500">{t.description}</p>
                </div>
                {local ? (
                  <Badge color="green">Built-in</Badge>
                ) : mine.length ? (
                  (() => {
                    const live = mine.filter((c: any) => !c.oauth || c.oauth.status === "connected").length;
                    const expired = mine.some((c: any) => c.oauth?.status === "expired");
                    return <Badge color={expired ? "red" : live ? "green" : "gray"}>{expired ? "Reconnect needed" : live ? `${live} connected` : "Disconnected"}</Badge>;
                  })()
                ) : isSso && providers && !enabled ? (
                  <Badge color="honey">Not enabled yet</Badge>
                ) : (
                  <Badge>Not connected</Badge>
                )}
              </div>
              {mine.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {mine.map((c: any) => (
                    <li key={c._id}>
                      <button className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-400/15 px-3 py-2 text-left hover:bg-hive-50" onClick={() => setOpen(c)}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{c.name}</span>
                          <span className="text-xs text-ink-500">
                            {c.oauth?.status === "revoked" ? "Disconnected · " : c.oauth?.status === "expired" ? "Login expired · " : ""}
                            {c.stats?.created || 0} new · {c.stats?.duplicates || 0} merged · {c.stats?.lastAt ? fmtDate(c.stats.lastAt) : "no data yet"}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {c.pendingRetries > 0 && <Badge color="red">{c.pendingRetries} failed</Badge>}
                          <span className={`h-2 w-2 rounded-full ${c.active ? "bg-hive-500" : "bg-ink-400"}`} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto flex flex-col gap-2 pt-4">
                {GUIDES[t.type] && (
                  <button type="button" onClick={() => setGuide({ type: t.type, label: t.label, c: mine[0] })} className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-hive-700 hover:text-hive-900">
                    <BookOpen className="h-4 w-4" /> Step-by-step setup guide
                  </button>
                )}
                {isSso && providers && !enabled && <p className="text-center text-xs text-ink-500">Your platform administrator switches this on in Super Admin › Platform Apps.</p>}
                {local ? (
                  <Link href="/app/leads" className="btn-secondary w-full">
                    {t.inbound === "upload" ? "Import from Leads" : "Add from Leads"}
                  </Link>
                ) : isSso ? (
                  perm.create &&
                  enabled && (
                    <Btn variant={mine.length ? "secondary" : "primary"} className="w-full" onClick={() => setSso({ type: t.type, label: t.label })}>
                      <Icon className="h-4 w-4" /> {mine.length ? "Connect another" : `Connect with ${SSO_INFO[t.type as SsoType].provider === "google" ? "Google" : SSO_INFO[t.type as SsoType].provider === "linkedin" ? "LinkedIn" : "Facebook"}`}
                    </Btn>
                  )
                ) : t.hidden ? null : (
                  perm.create && (
                    <Btn variant="secondary" className="w-full" onClick={() => setCreate({ type: t.type, name: mine.length ? `${t.label} ${mine.length + 1}` : t.label, defaultCampaign: "", defaultMedium: "", defaultSource: "", secret: "", platformKey: "", config: blankCfg(t.type) })}>
                      <Plus className="h-4 w-4" /> {mine.length ? "Add another" : "Connect"}
                    </Btn>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!create}
        onClose={() => setCreate(null)}
        title={`Connect · ${data.types.find((t: any) => t.type === create?.type)?.label || ""}`}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setCreate(null)}>
              Cancel
            </Btn>
            <Btn
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const body = { ...create };
                  if (!body.secret) delete body.secret;
                  if (!body.platformKey) delete body.platformKey;
                  if (!body.config) delete body.config;
                  const c = await api("/co/integrations", { body });
                  setCreate(null);
                  load();
                  setOpen(c);
                } catch (e: any) {
                  toast("err", e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create connector
            </Btn>
          </>
        }
      >
        {create && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start justify-between gap-3 rounded-xl bg-hive-50 p-3 text-sm text-ink-700 sm:col-span-2">
              <p>{GUIDES[create.type]?.summary || HELP[create.type]}</p>
              {GUIDES[create.type] && (
                <button type="button" className="shrink-0 font-semibold text-hive-700" onClick={() => setGuide({ type: create.type, label: data.types.find((t: any) => t.type === create.type)?.label })}>
                  Guide →
                </button>
              )}
            </div>
            {create.type === "indiamart" && (
              <div className="sm:col-span-2">
                <IndiaMartForm platformKey={create.platformKey} setPlatformKey={(v) => setCreate((c: any) => ({ ...c, platformKey: v }))} />
              </div>
            )}
            {create.type === "tradeindia" && (
              <div className="sm:col-span-2">
                <TradeIndiaForm cfg={create.config} set={(v) => setCreate((c: any) => ({ ...c, config: v }))} platformKey={create.platformKey} setPlatformKey={(v) => setCreate((c: any) => ({ ...c, platformKey: v }))} />
              </div>
            )}
            {create.type === "shopify" && (
              <div className="sm:col-span-2">
                <ShopifyForm cfg={create.config} set={(v) => setCreate((c: any) => ({ ...c, config: v }))} platformKey={create.platformKey} setPlatformKey={(v) => setCreate((c: any) => ({ ...c, platformKey: v }))} />
              </div>
            )}
            {create.type === "woocommerce" && (
              <div className="sm:col-span-2">
                <WooForm cfg={create.config} set={(v) => setCreate((c: any) => ({ ...c, config: v }))} platformKey={create.platformKey} setPlatformKey={(v) => setCreate((c: any) => ({ ...c, platformKey: v }))} />
              </div>
            )}
            {create.type === "web_prospect" && (
              <div className="sm:col-span-2">
                <ProspectForm
                  cfg={create.config}
                  set={(v) => setCreate((c: any) => ({ ...c, config: v }))}
                  searchKey={create.platformKey}
                  setSearchKey={(v) => setCreate((c: any) => ({ ...c, platformKey: v }))}
                  bskyPass={create.secret}
                  setBskyPass={(v) => setCreate((c: any) => ({ ...c, secret: v }))}
                />
              </div>
            )}
            {create.type === "mcp" && (
              <div className="sm:col-span-2">
                <McpForm cfg={create.config} set={(v) => setCreate((c: any) => ({ ...c, config: v }))} secret={create.secret} setSecret={(v) => setCreate((c: any) => ({ ...c, secret: v }))} />
              </div>
            )}
            <Field label="Name" required className="sm:col-span-2">
              <input className="input" value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
            </Field>
            <Field label="Campaign name">
              <input className="input" placeholder="e.g. Puja Health Camp 2026" value={create.defaultCampaign} onChange={(e) => setCreate({ ...create, defaultCampaign: e.target.value })} />
            </Field>
            <Field label="Medium">
              <input className="input" placeholder="cpc, organic, referral…" value={create.defaultMedium} onChange={(e) => setCreate({ ...create, defaultMedium: e.target.value })} />
            </Field>
            <Field label="Source label" hint={`Default: ${create.type}`}>
              <input className="input" value={create.defaultSource} onChange={(e) => setCreate({ ...create, defaultSource: e.target.value })} />
            </Field>
            {["meta_leads", "google_ads"].includes(create.type) && (
              <Field label={create.type === "meta_leads" ? "Page access token" : "Google webhook key"} hint="Leave blank to generate one">
                <input className="input mono" type="password" value={create.secret} onChange={(e) => setCreate({ ...create, secret: e.target.value })} />
              </Field>
            )}
          </div>
        )}
      </Modal>

      <ConnectorDrawer c={open} onClose={() => setOpen(null)} onChanged={load} onReconnect={(c: any) => {
        setOpen(null);
        setSso({ type: c.type, label: data.types.find((t: any) => t.type === c.type)?.label || c.name, connectorId: c._id });
      }} />
      <SsoConnect type={sso?.type || null} label={sso?.label || ""} connectorId={sso?.connectorId} providers={providers} onClose={() => setSso(null)} onDone={load} />

      <Modal open={!!guide} onClose={() => setGuide(null)} title={`Setup guide · ${guide?.label || ""}`} size="lg">
        {guide && (
          <>
            {!guide.c && !["manual", "bulk_import"].includes(guide.type) && (
              <p className="mb-4 rounded-xl bg-[#f7f8f6] px-3 py-2 text-xs text-ink-500">Connect first to see your own URL and keys filled into the steps.</p>
            )}
            <GuideSteps type={guide.type} c={guide.c} />
          </>
        )}
      </Modal>
    </>
  );
}

function ConnectorDrawer({ c, onClose, onChanged, onReconnect }: { c: any; onClose: () => void; onChanged: () => void; onReconnect: (c: any) => void }) {
  const [tab, setTab] = useState<"setup" | "settings" | "mapping" | "deliveries">("setup");
  const [pushUrl, setPushUrl] = useState<string | undefined>();
  const [platformKey, setPlatformKey] = useState("");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [newSecret, setNewSecret] = useState("");

  const [secret, setSecret] = useState<string | undefined>();
  const [map, setMap] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const [del, setDel] = useState(false);
  const perm = usePerm("integrations");
  const toast = useToast();

  useEffect(() => {
    if (!c) return;
    setTab("setup");
    setSecret(c.secret);
    setMap(c.fieldMap || {});
    setEvents(null);
    setLastRun(c.lastRun ? { ...c.lastRun, at: c.lastRunAt } : null);
    setCfg(HAS_SETTINGS.includes(c.type) ? { ...(blankCfg(c.type) || {}), ...(c.config || {}) } : null);
    setNewSecret("");
    setPlatformKey("");
    setPushUrl(c.pushUrl);
  }, [c]);
  useEffect(() => {
    if (c && tab === "deliveries") api(`/co/integrations/${c._id}/events`).then(setEvents);
  }, [c, tab]);
  if (!c) return null;

  const curl = `curl -X POST '${c.endpoint}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-api-key: ${secret || "<your-secret>"}' \\\n  -H 'Idempotency-Key: form-123' \\\n  -d '{"name":"Riya Sen","phone":"9876543210","email":"riya@example.com","message":"Full body checkup","utm_campaign":"puja-camp","consent":"yes"}'`;
  const html = `<form action="${c.endpoint}" method="POST">\n  <input name="name" required>\n  <input name="phone" required>\n  <input name="email" type="email">\n  <textarea name="message"></textarea>\n  <input name="consent" type="checkbox" value="yes"> I agree to be contacted on WhatsApp\n  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">\n  <button>Submit</button>\n</form>`;

  return (
    <Modal open={!!c} onClose={onClose} title={c.name} size="lg">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "setup", label: "Setup" },
          ...(HAS_SETTINGS.includes(c.type) ? [{ key: "settings" as const, label: "Settings" }] : []),
          { key: "mapping" as const, label: "Field mapping" },
          { key: "deliveries" as const, label: "Deliveries" },
        ]}
      />
      {tab === "setup" && c.type === "web_prospect" && <ProspectPanel c={c} onChanged={onChanged} />}
      {tab === "setup" && isSsoType(c.type) && <SsoPanel c={c} onChanged={onChanged} onClose={onClose} onReconnect={() => onReconnect(c)} onDelete={() => setDel(true)} />}
      {tab === "setup" && HAS_PULL.includes(c.type) && c.type !== "web_prospect" && (
        <div className="mb-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-400/15 p-4">
            <div>
              <p className="text-sm font-semibold">
                {c.type === "mcp"
                  ? "Fetches daily at 2:00 AM IST"
                  : !pullReady(c)
                    ? c.type === "indiamart"
                      ? "Pull API not set — add your key in Settings for the 15-minute safety net"
                      : "Webhooks only — add REST API keys in Settings for the 15-minute safety net"
                    : `Fetches every 15 minutes${c.type === "indiamart" ? " (plus instant Push)" : c.type === "woocommerce" ? " (plus instant webhooks)" : ""}`}
              </p>
              <p className="text-xs text-ink-500">
                {lastRun?.at || c.lastRunAt ? `Last run ${fmtDate(lastRun?.at || c.lastRunAt)}` : "Not run yet"}
                {lastRun && (lastRun.ok === false ? ` · failed: ${lastRun.error}` : lastRun.throttled ? " · IndiaMART asked to wait 5 minutes — next run will catch up" : lastRun.skipped ? ` · ${lastRun.skipped}` : ` · ${lastRun.found ?? 0} found · ${lastRun.created ?? 0} new lead(s) · ${lastRun.duplicates ?? 0} already in Leads`)}
              </p>
              {lastRun?.errors?.length > 0 && lastRun.ok !== false && <p className="mt-1 text-xs text-red-700">{lastRun.errors.join(" · ")}</p>}
            </div>
            {perm.update && pullReady(c) && (
              <Btn
                loading={running}
                onClick={async () => {
                  setRunning(true);
                  try {
                    const r = await api(`/co/integrations/${c._id}/run`, { method: "POST" });
                    setLastRun({ ...r, at: new Date().toISOString() });
                    toast(r.ok === false ? "err" : "ok", r.ok === false ? r.error || "Run failed" : `${r.found ?? 0} found · ${r.created ?? 0} new lead(s)`);
                    onChanged();
                  } catch (e: any) {
                    toast("err", e.message);
                  } finally {
                    setRunning(false);
                  }
                }}
              >
                <Play className="h-4 w-4" /> Run now
              </Btn>
            )}
          </div>
          {PULL_ONLY.includes(c.type) && <GuideSteps type={c.type} c={c} compact />}
        </div>
      )}
      {tab === "settings" && cfg && (
        <div className="space-y-4">
          {c.type === "mcp" && <McpForm cfg={cfg} set={setCfg} secret={newSecret} setSecret={setNewSecret} connectorId={c._id} editing />}
          {c.type === "indiamart" && <IndiaMartForm platformKey={platformKey} setPlatformKey={setPlatformKey} editing masked={c.platformKeyMasked} />}
          {c.type === "tradeindia" && <TradeIndiaForm cfg={cfg} set={setCfg} platformKey={platformKey} setPlatformKey={setPlatformKey} editing masked={c.platformKeyMasked} />}
          {c.type === "google_ads" && <GoogleAdsForm cfg={cfg} set={setCfg} />}
          {c.type === "shopify" && <ShopifyForm cfg={cfg} set={setCfg} platformKey={platformKey} setPlatformKey={setPlatformKey} editing masked={c.platformKeyMasked} />}
          {c.type === "web_prospect" && (
            <ProspectForm cfg={cfg} set={setCfg} searchKey={platformKey} setSearchKey={setPlatformKey} bskyPass={newSecret} setBskyPass={setNewSecret} editing searchKeyMasked={c.platformKeyMasked} bskyPassSaved={!!c.secretMasked} />
          )}
          {c.type === "woocommerce" && <WooForm cfg={cfg} set={setCfg} platformKey={platformKey} setPlatformKey={setPlatformKey} editing masked={c.platformKeyMasked} />}
          {perm.update && (
            <Btn
              onClick={async () => {
                try {
                  const body: any = { ...(c.type === "indiamart" ? {} : { config: cfg }), ...(newSecret ? { secret: newSecret } : {}), ...(platformKey ? { platformKey } : {}) };
                  await api(`/co/integrations/${c._id}`, { method: "PUT", body });
                  toast("ok", "Settings saved");
                  onChanged();
                } catch (e: any) {
                  toast("err", e.message);
                }
              }}
            >
              Save settings
            </Btn>
          )}
        </div>
      )}
      {tab === "setup" && !PULL_ONLY.includes(c.type) && !isSsoType(c.type) && (
        <div className="space-y-4">
          {PUSH_PLATFORMS.includes(c.type) ? (
            pushUrl ? (
              <div className="rounded-xl border border-honey-300 bg-honey-100/60 p-3">
                <CopyRow label="Your Lead URL — shown once, copy it now" value={pushUrl} />
              </div>
            ) : (
              <CopyRow label="Lead URL (use “New Lead URL” below to issue a fresh one)" value={c.pushUrlMasked} />
            )
          ) : (
            <CopyRow label="Endpoint URL" value={c.endpoint} />
          )}

          {PUSH_PLATFORMS.includes(c.type) ? null : secret ? (
            <div className="rounded-xl border border-honey-300 bg-honey-100/60 p-3">
              <CopyRow label="Secret / API key — shown once, copy it now" value={secret} />
            </div>
          ) : (
            <CopyRow label="Secret / API key" value={c.secretMasked} />
          )}
          <CopyRow label="Meta verify token" value={c.verifyToken} />
          {["website_form", "whatsapp"].includes(c.type) && c.authMode !== "key" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="min-w-0 flex-1">Older setup: this connector still accepts {c.type === "whatsapp" ? "Meta deliveries" : "browser posts"} without the API key. Update your {c.type === "whatsapp" ? "Callback URL" : "form"} as in the steps below, then require the key.</p>
              {perm.update && (
                <Btn
                  variant="secondary"
                  onClick={async () => {
                    await api(`/co/integrations/${c._id}`, { method: "PUT", body: { authMode: "key" } });
                    toast("ok", "API key now required on every call");
                    onChanged();
                    onClose();
                  }}
                >
                  Require API key
                </Btn>
              )}
            </div>
          )}
          {c.formUrl && (
            <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-ink-400/15 p-4">
              <Qr text={c.formUrl} />
              <div className="min-w-0 flex-1">
                <CopyRow label="Hosted form" value={c.formUrl} />
                <a href={c.formUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-hive-700">
                  Open form →
                </a>
              </div>
            </div>
          )}
          <details className="group rounded-2xl border border-ink-400/15 p-4" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold">
              <BookOpen className="h-4 w-4 text-hive-700" /> Step-by-step setup
            </summary>
            <div className="mt-4">
              <GuideSteps type={c.type} c={{ ...c, secret }} compact />
            </div>
          </details>
          <div className="flex flex-wrap gap-2 border-t border-ink-400/10 pt-4">
            {perm.update && (
              <Btn
                variant="secondary"
                onClick={async () => {
                  await api(`/co/integrations/${c._id}`, { method: "PUT", body: { active: !c.active } });
                  onChanged();
                  onClose();
                }}
              >
                <Power className="h-4 w-4" /> {c.active ? "Pause" : "Resume"}
              </Btn>
            )}
            {perm.update && !["meta_leads", "google_ads"].includes(c.type) && (
              <Btn
                variant="secondary"
                onClick={async () => {
                  const r = await api(`/co/integrations/${c._id}/rotate`, { method: "POST" });
                  setSecret(r.secret);
                  setPushUrl(r.pushUrl);
                  toast("ok", PUSH_PLATFORMS.includes(c.type) ? "New Lead URL generated — send it to the platform; the old one stops working" : "New secret generated — update the sending system");
                }}
              >
                <KeyRound className="h-4 w-4" /> {PUSH_PLATFORMS.includes(c.type) ? "New Lead URL" : "Rotate secret"}
              </Btn>
            )}
            {perm.delete && (
              <Btn variant="secondary" className="ml-auto text-red-600" onClick={() => setDel(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Btn>
            )}
          </div>
        </div>
      )}
      {tab === "mapping" && (
        <div className="space-y-4">
          <p className="text-sm text-ink-500">Common names (name, full_name, phone, mobile, email, message, utm_campaign…) map automatically. Override only when your payload uses different keys — dot paths like data.mobile work.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {["name", "phone", "whatsapp", "email", "address", "comments", "campaign", "medium", "referral"].map((k) => (
              <Field key={k} label={k}>
                <input className="input mono" placeholder="auto" value={map[k] || ""} onChange={(e) => setMap({ ...map, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          {perm.update && (
            <Btn
              onClick={async () => {
                await api(`/co/integrations/${c._id}`, { method: "PUT", body: { fieldMap: Object.fromEntries(Object.entries(map).filter(([, v]) => v)) } });
                toast("ok", "Mapping saved");
                onChanged();
              }}
            >
              Save mapping
            </Btn>
          )}
        </div>
      )}
      {tab === "deliveries" && (
        <div className="overflow-x-auto">
          {!events ? (
            <div className="flex justify-center py-10 text-hive-700">
              <Spinner />
            </div>
          ) : (
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  {["Received", "Idempotency key", "Status", "Attempts", "Error", ""].map((h) => (
                    <th key={h} className="th">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.items.map((e: any) => (
                  <tr key={e._id}>
                    <td className="td whitespace-nowrap text-ink-500">{fmtDate(e.createdAt)}</td>
                    <td className="td mono max-w-[160px] truncate">{e.idemKey}</td>
                    <td className="td">
                      <Badge color={e.status === "created" ? "green" : e.status === "merged" ? "blue" : e.status === "processing" ? "gray" : "red"}>{e.status}</Badge>
                    </td>
                    <td className="td tabular-nums">{e.attempts}</td>
                    <td className="td max-w-[200px] truncate text-red-700" title={e.error}>
                      {e.error || "—"}
                    </td>
                    <td className="td whitespace-nowrap">
                      <button className="btn-ghost" onClick={() => setView(e.payload)}>
                        Payload
                      </button>
                      {["failed", "dead"].includes(e.status) && perm.update && (
                        <button
                          className="btn-ghost"
                          onClick={async () => {
                            const r = await api(`/co/integrations/events/${e._id}/retry`, { method: "POST" });
                            toast(r.ok ? "ok" : "err", r.ok ? "Processed" : r.error);
                            setEvents(await api(`/co/integrations/${c._id}/events`));
                          }}
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {events && !events.items.length && <p className="py-10 text-center text-sm text-ink-400">No deliveries yet</p>}
          {view && (
            <div className="mt-4">
              <JsonView value={view} />
            </div>
          )}
        </div>
      )}
      <Confirm
        open={del}
        danger
        title="Delete connector?"
        body={isSsoType(c.type) ? "Consent is withdrawn and the login deleted, then the connector is removed. Existing leads keep their attribution." : "The endpoint stops accepting leads immediately. Existing leads keep their attribution."}
        confirmLabel="Delete"
        onClose={() => setDel(false)}
        onConfirm={async () => {
          await api(`/co/integrations/${c._id}`, { method: "DELETE" });
          onChanged();
          onClose();
        }}
      />
    </Modal>
  );
}

/* ───────────── Public Web Prospecting: schedule, Test Now, Run now, activity ───────────── */
const na = (v: any) => (v == null || v === "" ? "NA" : String(v));
const INTENT_TONE: Record<string, string> = { high: "bg-hive-100 text-hive-900", medium: "bg-honey-100 text-amber-900", low: "bg-ink-400/10 text-ink-700" };

function ProspectPanel({ c, onChanged }: { c: any; onChanged: () => void }) {
  const perm = usePerm("integrations");
  const toast = useToast();
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [state, setState] = useState<any>(c.prospect || {});
  const [lastRun, setLastRun] = useState<any>(c.lastRun ? { ...c.lastRun, at: c.lastRunAt } : null);
  useEffect(() => {
    setState(c.prospect || {});
    setLastRun(c.lastRun ? { ...c.lastRun, at: c.lastRunAt } : null);
  }, [c]);
  const t = state.today || {};

  async function test() {
    setTesting(true);
    try {
      setResult(await api(`/co/integrations/${c._id}/test`, { method: "POST" }));
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setTesting(false);
    }
  }
  async function run() {
    setRunning(true);
    try {
      const r = await api(`/co/integrations/${c._id}/run`, { method: "POST" });
      if (r.ok === false) toast("err", r.error || "Run failed");
      else toast("ok", `${r.created ?? 0} new lead(s) · ${r.duplicates ?? 0} already in Leads${r.remaining ? ` · ${r.remaining} more being read in the background` : ""}`);
      setLastRun({ ...r, at: new Date().toISOString() });
      setState((s: any) => ({ ...s, queued: r.remaining ?? 0, seededAt: new Date().toISOString(), today: { found: r.found, created: r.created, duplicates: r.duplicates, skipped: r.skipped, failed: r.failed }, log: [...(s.log || []), ...(r.log || [])].slice(-40) }));
      onChanged();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mb-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-400/15 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Runs every day at 2:00 AM IST</p>
          <p className="text-xs text-ink-500">
            {state.seededAt ? `Last started ${fmtDate(state.seededAt)}` : "Not run yet"}
            {state.seededAt && ` · ${t.created ?? 0} new · ${t.duplicates ?? 0} already in Leads · ${t.skipped ?? 0} skipped`}
            {state.queued ? ` · ${state.queued} still to read (continues automatically every 15 min)` : ""}
          </p>
          {lastRun?.ok === false && lastRun.error && <p className="mt-1 text-xs text-red-700">{lastRun.error}</p>}
        </div>
        {perm.update && (
          <div className="flex gap-2">
            <Btn variant="secondary" loading={testing} onClick={test}>
              <FlaskConical className="h-4 w-4" /> Test Now
            </Btn>
            <Btn loading={running} onClick={run}>
              <Play className="h-4 w-4" /> Run now
            </Btn>
          </div>
        )}
      </div>
      {state.log?.length > 0 && (
        <details className="rounded-2xl border border-ink-400/15 p-4">
          <summary className="cursor-pointer text-sm font-bold">Recent activity</summary>
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-ink-700">
            {[...state.log].reverse().map((l: any, i: number) => (
              <li key={i}>
                <span className="text-ink-400">{fmtDate(l.at)}</span> · {l.msg}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal open={!!result} onClose={() => setResult(null)} title="Test Now — preview" size="xl">
        {result && (
          <div className="space-y-4">
            <p className="rounded-xl bg-hive-50 px-3 py-2 text-sm text-ink-700">
              Dry run: nothing was saved. Checked {result.candidates} page(s)/post(s), read {result.read}, found <b>{result.rows.length}</b> lead(s). Missing details show as NA. AI credits were used for the pages that were read.
            </p>
            {result.rows.length ? (
              <div className="overflow-x-auto rounded-xl border border-ink-400/15">
                <table className="w-full min-w-[960px] text-sm">
                  <thead>
                    <tr>
                      {["Name", "Phone", "Email", "WhatsApp", "Profile / post", "Location", "Organisation", "Looking for", "Intent", "Source"].map((h) => (
                        <th key={h} className="th">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r: any, i: number) => (
                      <tr key={i} className="align-top">
                        <td className="td font-semibold">{na(r.name)}</td>
                        <td className="td mono">{na(r.phone)}</td>
                        <td className="td">{na(r.email)}</td>
                        <td className="td mono">{na(r.whatsapp)}</td>
                        <td className="td max-w-[160px] truncate">
                          {r.profileUrl ? (
                            <a href={r.profileUrl} target="_blank" rel="noreferrer noopener" className="text-hive-700 underline">
                              {r.profileUrl.replace(/^https?:\/\//, "")}
                            </a>
                          ) : (
                            "NA"
                          )}
                        </td>
                        <td className="td">{na(r.location)}</td>
                        <td className="td">{na(r.organisation)}</td>
                        <td className="td max-w-[200px]">
                          {na(r.requirement)}
                          {r.quote && <p className="mt-1 text-xs italic text-ink-500">“{r.quote}”</p>}
                        </td>
                        <td className="td">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${INTENT_TONE[r.intent] || ""}`}>{r.intent}</span>
                        </td>
                        <td className="td max-w-[180px]">
                          <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-hive-700 underline">
                            <span className="truncate">{r.sourceTitle}</span> <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <p className="text-xs text-ink-400">
                            {r.sourceKind} · {r.keyword}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-ink-400/30 p-6 text-center text-sm text-ink-500">No one matching your keywords was found in this sample. Try other wording people would use, a wider look-back, or more sources.</p>
            )}
            {result.log?.length > 0 && (
              <details open={!result.rows.length}>
                <summary className="cursor-pointer text-sm font-bold">What was checked</summary>
                <ul className="mt-2 space-y-1 text-xs text-ink-700">
                  {result.log.map((l: any, i: number) => (
                    <li key={i}>• {l.msg}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ───────────── Sign-in connectors (Facebook, Instagram, LinkedIn, Google Sheets) ───────────── */
function SsoPanel({ c, onChanged, onClose, onReconnect, onDelete }: { c: any; onChanged: () => void; onClose: () => void; onReconnect: () => void; onDelete: () => void }) {
  const perm = usePerm("integrations");
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<any>(c.lastRun ? { ...c.lastRun, at: c.lastRunAt } : null);
  const [disc, setDisc] = useState(false);
  const status = c.oauth?.status || "connected";
  const o = c.sso || {};
  const info = SSO_INFO[c.type as SsoType];
  const rows: { name: string; detail: string; ok: boolean }[] =
    c.type === "google_sheets"
      ? o.sheet
        ? [{ name: o.sheet.title, detail: `Tab “${o.sheet.tab}” · next row read: ${o.sheet.row + 1}`, ok: true }]
        : []
      : c.type === "linkedin_leads"
        ? [...(o.adAccounts || []).map((a: any) => ({ name: a.name, detail: `Ad account · ${o.notifications?.[a.id] === "subscribed" ? "instant notifications on" : "fetched every 15 minutes"}`, ok: true })), ...(o.organizations || []).map((a: any) => ({ name: a.name, detail: "LinkedIn Page", ok: true }))]
        : (o.pages || []).map((p: any) => ({ name: c.type === "instagram_leads" && p.ig ? `@${p.ig.username} (${p.name})` : p.name, detail: p.subscribed ? "Real-time lead webhook on" : `Real-time off${p.error ? ` (${p.error})` : ""} — fetched every 15 minutes`, ok: !!p.subscribed }));

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border p-4 ${status === "connected" ? "border-hive-200 bg-hive-50/50" : status === "expired" ? "border-red-200 bg-red-50" : "border-ink-400/20 bg-[#f7f8f6]"}`}>
        <div className="min-w-0">
          <p className="text-sm font-bold">
            {status === "connected" ? `Connected to ${info.platform}` : status === "expired" ? "Login expired — reconnect to keep receiving leads" : "Disconnected — consent withdrawn"}
          </p>
          <p className="text-xs text-ink-500">
            {c.oauth?.account?.name ? `Signed in as ${c.oauth.account.name}` : ""}
            {c.oauth?.connectedAt ? ` · ${fmtDate(c.oauth.connectedAt)}` : ""}
            {c.oauth?.connectedBy ? ` by ${c.oauth.connectedBy}` : ""}
          </p>
          {c.oauth?.error && <p className="mt-1 text-xs text-red-700">{c.oauth.error}</p>}
        </div>
        {perm.update && status !== "connected" && (
          <Btn onClick={onReconnect}>
            <KeyRound className="h-4 w-4" /> Reconnect
          </Btn>
        )}
      </div>

      {rows.length > 0 && (
        <div className="rounded-2xl border border-ink-400/15 p-4">
          <p className="mb-2 text-sm font-bold">Connected {info.pick}</p>
          <ul className="space-y-1.5">
            {rows.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.ok ? "bg-hive-500" : "bg-amber-500"}`} />
                <span>
                  <b>{r.name}</b> <span className="text-ink-500">· {r.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status !== "revoked" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-400/15 p-4">
          <div>
            <p className="text-sm font-semibold">{c.type === "google_sheets" ? "New rows are read every 15 minutes" : "Leads arrive instantly; a check every 15 minutes catches anything missed"}</p>
            <p className="text-xs text-ink-500">
              {lastRun?.at ? `Last fetch ${fmtDate(lastRun.at)}` : "Not fetched yet"}
              {lastRun && (lastRun.ok === false ? ` · failed: ${lastRun.error}` : ` · ${lastRun.found ?? 0} found · ${lastRun.created ?? 0} new lead(s) · ${lastRun.duplicates ?? 0} already in Leads`)}
            </p>
            {lastRun?.note && <p className="mt-1 text-xs text-amber-800">{lastRun.note}</p>}
          </div>
          {perm.update && (
            <Btn
              loading={running}
              onClick={async () => {
                setRunning(true);
                try {
                  const r = await api(`/co/integrations/${c._id}/run`, { method: "POST" });
                  setLastRun({ ...r, at: new Date().toISOString() });
                  toast(r.ok === false ? "err" : "ok", r.ok === false ? r.error || "Fetch failed" : `${r.found ?? 0} found · ${r.created ?? 0} new lead(s)`);
                  onChanged();
                } catch (e: any) {
                  toast("err", e.message);
                } finally {
                  setRunning(false);
                }
              }}
            >
              <Play className="h-4 w-4" /> Fetch now
            </Btn>
          )}
        </div>
      )}

      {c.consent && (
        <div className="rounded-2xl border border-ink-400/15 p-4 text-[13px] text-ink-700">
          <p className="mb-1 font-bold text-ink-900">✓ Consent recorded (DPDP Act)</p>
          <p>
            {c.consent.by} · {fmtDate(c.consent.at)} · notice {c.consent.version} · IP {c.consent.ip || "—"}
            {c.consent.all ? " · “I agree to all”" : ""}
          </p>
          <p className="text-ink-500">Purposes: {info.purposes.filter((p) => (c.consent.purposes || []).includes(p.key)).map((p) => p.label).join(" · ")}</p>
          {c.consent.withdrawnAt && (
            <p className="mt-1 font-semibold text-red-700">
              Withdrawn {fmtDate(c.consent.withdrawnAt)}
              {c.consent.withdrawnBy ? ` by ${c.consent.withdrawnBy}` : ""} — login deleted
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-ink-400/10 pt-4">
        {perm.update && status === "connected" && (
          <Btn variant="secondary" onClick={onReconnect}>
            <KeyRound className="h-4 w-4" /> Reconnect / change {c.type === "google_sheets" ? "sheet" : "selection"}
          </Btn>
        )}
        {perm.update && status !== "revoked" && (
          <Btn
            variant="secondary"
            onClick={async () => {
              await api(`/co/integrations/${c._id}`, { method: "PUT", body: { active: !c.active } });
              onChanged();
              onClose();
            }}
          >
            <Power className="h-4 w-4" /> {c.active ? "Pause" : "Resume"}
          </Btn>
        )}
        {perm.update && status !== "revoked" && (
          <Btn variant="secondary" className="text-red-600" onClick={() => setDisc(true)}>
            <EyeOff className="h-4 w-4" /> Disconnect
          </Btn>
        )}
        {perm.delete && (
          <Btn variant="secondary" className="ml-auto text-red-600" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Delete
          </Btn>
        )}
      </div>
      <Confirm
        open={disc}
        danger
        title={`Disconnect ${info.platform}?`}
        body="This withdraws consent: the stored login is deleted at once and no more leads are received. Leads already received stay. You can connect again any time."
        confirmLabel="Disconnect"
        onClose={() => setDisc(false)}
        onConfirm={async () => {
          await api(`/co/integrations/${c._id}/disconnect`, { method: "POST" });
          toast("ok", "Disconnected — login deleted");
          setDisc(false);
          onChanged();
          onClose();
        }}
      />
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy as CopyIcon, Plus, Power, KeyRound, Trash2 } from "lucide-react";
import { icon } from "@/components/icons";
import { api, fmtDate } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Spinner, Confirm, JsonView, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";
import { Tabs } from "@/components/Logs";

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
  website_form: "Point your form's action (or fetch POST) at the endpoint. Fields like name, phone, email, message and utm_* are mapped automatically. Add a hidden empty input named _hp as a bot trap.",
  rest_api: "POST JSON with header x-api-key. Send an Idempotency-Key header to make retries safe. Create one connector per system so attribution stays clean.",
  whatsapp: "Set the endpoint as the Callback URL in Meta → WhatsApp → Configuration and use the secret as Verify token. Every inbound chat becomes (or updates) a lead.",
  meta_leads: "Meta App → Webhooks → Page → leadgen. Callback = endpoint, Verify token = the token below. Paste a Page access token as the secret so lead details can be fetched.",
  google_ads: "Google Ads → Lead form asset → Webhook integration. Webhook URL = endpoint, Key = the secret.",
  email: "In SendGrid Inbound Parse / Mailgun Routes / Postmark inbound, forward to the endpoint with ?key=<secret>. Sender, subject and body become the lead.",
  telephony: "In Exotel / Knowlarity / Ozonetel, add a passthru / call webhook to the endpoint with ?key=<secret>. Caller number becomes the lead.",
  qr_campaign: "Print the QR code. It opens a hosted mobile form tagged with this connector's campaign.",
  partner: "Give each partner their own connector. Every lead is credited via the referral field and attribution history.",
};

export default function Integrations() {
  const [data, setData] = useState<any>(null);
  const [create, setCreate] = useState<any>(null);
  const [open, setOpen] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("integrations");
  const toast = useToast();
  const load = () => api("/co/integrations").then(setData);
  useEffect(() => {
    load();
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
          const local = t.inbound === "manual" || t.inbound === "upload";
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
                {local ? <Badge color="green">Built-in</Badge> : mine.length ? <Badge color="green">{mine.length} connected</Badge> : <Badge>Not connected</Badge>}
              </div>
              {mine.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {mine.map((c: any) => (
                    <li key={c._id}>
                      <button className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-400/15 px-3 py-2 text-left hover:bg-hive-50" onClick={() => setOpen(c)}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{c.name}</span>
                          <span className="text-xs text-ink-500">
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
              <div className="mt-auto pt-4">
                {local ? (
                  <Link href="/app/leads" className="btn-secondary w-full">
                    {t.inbound === "upload" ? "Import from Leads" : "Add from Leads"}
                  </Link>
                ) : (
                  perm.create && (
                    <Btn variant="secondary" className="w-full" onClick={() => setCreate({ type: t.type, name: mine.length ? `${t.label} ${mine.length + 1}` : t.label, defaultCampaign: "", defaultMedium: "", defaultSource: "", secret: "" })}>
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
            <p className="rounded-xl bg-hive-50 p-3 text-sm text-ink-700 sm:col-span-2">{HELP[create.type]}</p>
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

      <ConnectorDrawer c={open} onClose={() => setOpen(null)} onChanged={load} />
    </>
  );
}

function ConnectorDrawer({ c, onClose, onChanged }: { c: any; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<"setup" | "mapping" | "deliveries">("setup");
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
  }, [c]);
  useEffect(() => {
    if (c && tab === "deliveries") api(`/co/integrations/${c._id}/events`).then(setEvents);
  }, [c, tab]);
  if (!c) return null;

  const curl = `curl -X POST '${c.endpoint}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-api-key: ${secret || "<your-secret>"}' \\\n  -H 'Idempotency-Key: form-123' \\\n  -d '{"name":"Riya Sen","phone":"9876543210","email":"riya@example.com","message":"Full body checkup","utm_campaign":"puja-camp","consent":"yes"}'`;
  const html = `<form action="${c.endpoint}" method="POST">\n  <input name="name" required>\n  <input name="phone" required>\n  <input name="email" type="email">\n  <textarea name="message"></textarea>\n  <input name="consent" type="checkbox" value="yes"> I agree to be contacted on WhatsApp\n  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">\n  <button>Submit</button>\n</form>`;

  return (
    <Modal open={!!c} onClose={onClose} title={c.name} size="lg">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "setup", label: "Setup" }, { key: "mapping", label: "Field mapping" }, { key: "deliveries", label: "Deliveries" }]} />
      {tab === "setup" && (
        <div className="space-y-4">
          <p className="rounded-xl bg-hive-50 p-3 text-sm text-ink-700">{HELP[c.type]}</p>
          <CopyRow label="Endpoint URL" value={c.endpoint} />
          {secret ? (
            <div className="rounded-xl border border-honey-300 bg-honey-100/60 p-3">
              <CopyRow label="Secret / API key — shown once, copy it now" value={secret} />
            </div>
          ) : (
            <CopyRow label="Secret / API key" value={c.secretMasked} />
          )}
          <CopyRow label="Meta verify token" value={c.verifyToken} />
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
          {["rest_api", "website_form", "partner", "telephony", "email"].includes(c.type) && (
            <div>
              <p className="label">{c.type === "website_form" ? "HTML form" : "Example request"}</p>
              <JsonView value={c.type === "website_form" ? html : curl} />
            </div>
          )}
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
                  toast("ok", "New secret generated — update the sending system");
                }}
              >
                <KeyRound className="h-4 w-4" /> Rotate secret
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
        body="The endpoint stops accepting leads immediately. Existing leads keep their attribution."
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

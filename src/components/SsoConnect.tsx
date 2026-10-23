"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Lock, ShieldCheck, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Btn, Field, Modal, useToast } from "./ui";
import { SSO_INFO, type SsoType } from "@shared/sso";

type Providers = { enabled: Record<string, boolean>; consentVersion: string; privacy: { email: string; officer: string; legalName: string }; privacyUrl: string };

/**
 * Connect a sign-in channel: consent notice (DPDP Act) → the platform's own login page in a popup → pick → connected.
 * Nothing in the notice is pre-ticked: consent has to be a clear action ("I agree to all & connect" or ticking each).
 */
export function SsoConnect({ type, label, providers, connectorId, onClose, onDone }: { type: SsoType | null; label: string; providers: Providers | null; connectorId?: string; onClose: () => void; onDone: () => void }) {
  const info = type ? SSO_INFO[type] : null;
  const [step, setStep] = useState<"consent" | "wait" | "pick" | "done">("consent");
  const [ticked, setTicked] = useState<string[]>([]);
  const [state, setState] = useState<string>("");
  const [url, setUrl] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [campaign, setCampaign] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheet, setSheet] = useState<any>(null);
  const [tab, setTab] = useState("");
  const [importExisting, setImportExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const popup = useRef<Window | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!type) return;
    setStep("consent");
    setTicked([]);
    setState("");
    setErr("");
    setData(null);
    setSel([]);
    setName("");
    setCampaign("");
    setSheetUrl("");
    setSheet(null);
    setTab("");
    setResult(null);
    setBlocked(false);
  }, [type]);

  // waiting for the sign-in: the popup tells us (postMessage) and we also poll, in case the message is lost
  useEffect(() => {
    if (step !== "wait" || !state) return;
    let stop = false;
    const check = async () => {
      try {
        const s = await api(`/co/sso/state/${state}`);
        if (stop) return;
        if (s.status === "authorized") {
          setData(s);
          setSel((s.choices?.items || []).filter((i: any) => !i.disabled).map((i: any) => i.id));
          setStep("pick");
        } else if (s.status === "failed") setErr(s.error || "Sign-in failed");
      } catch (e: any) {
        if (!stop) setErr(e.message);
      }
    };
    const t = setInterval(check, 2000);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "credoone-sso" && e.data.state === state) {
        if (e.data.ok) check();
        else setErr(e.data.error || "Sign-in failed");
      }
    };
    window.addEventListener("message", onMsg);
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener("message", onMsg);
    };
  }, [step, state]);

  if (!type || !info) return null;
  const allTicked = info.purposes.every((p) => ticked.includes(p.key));

  async function start(all: boolean) {
    // open the window inside the click so popup blockers allow it; it is pointed at the platform once we have the link
    const w = window.open("", "credoone-sso", "width=620,height=760,menubar=no,toolbar=no");
    popup.current = w;
    setErr("");
    try {
      const r = await api("/co/sso/start", { body: { type, accepted: all ? info!.purposes.map((p) => p.key) : ticked, all, connectorId } });
      if (all) setTicked(info!.purposes.map((p) => p.key));
      setState(r.state);
      setUrl(r.url);
      if (w && !w.closed) w.location.href = r.url;
      else setBlocked(true);
      setStep("wait");
    } catch (e: any) {
      w?.close();
      setErr(e.message);
    }
  }

  async function findTabs() {
    setBusy(true);
    try {
      const r = await api(`/co/sso/state/${state}/sheet`, { body: { url: sheetUrl } });
      setSheet(r);
      setTab(r.tabs[0] || "");
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      const r = await api(`/co/sso/state/${state}/finish`, { body: { selected: sel, name: name || undefined, defaultCampaign: campaign || undefined, sheetUrl: sheetUrl || undefined, tab: tab || undefined, importExisting } });
      setResult(r);
      setStep("done");
      onDone();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  const items: any[] = data?.choices?.items || [];
  const footer =
    step === "consent" ? (
      <>
        <Btn variant="secondary" onClick={onClose}>
          Cancel
        </Btn>
        <Btn variant="secondary" disabled={!allTicked} onClick={() => start(false)}>
          Continue
        </Btn>
        <Btn onClick={() => start(true)}>I agree to all &amp; connect</Btn>
      </>
    ) : step === "pick" ? (
      <>
        <Btn variant="secondary" onClick={onClose}>
          Cancel
        </Btn>
        <Btn loading={busy} disabled={type === "google_sheets" ? !sheet || !tab : !sel.length} onClick={finish}>
          {connectorId ? "Reconnect" : "Connect"}
        </Btn>
      </>
    ) : step === "done" ? (
      <Btn onClick={onClose}>Done</Btn>
    ) : (
      <Btn variant="secondary" onClick={onClose}>
        Cancel
      </Btn>
    );

  return (
    <Modal open={!!type} onClose={onClose} title={`${connectorId ? "Reconnect" : "Connect"} · ${label}`} size="md" footer={footer}>
      {step === "consent" && (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-2xl bg-hive-50/70 p-4 text-sm text-ink-700">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-hive-700" />
            <p>
              You’ll sign in on <b>{info.provider === "meta" ? "facebook.com" : info.provider === "linkedin" ? "linkedin.com" : "accounts.google.com"}</b> in a secure window, with your own ID and password. We never see or store your password. Then pick the {info.pick} to connect.
            </p>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-900">
              <ShieldCheck className="h-4 w-4 text-hive-700" /> Consent notice (Digital Personal Data Protection Act, 2023)
            </p>
            <p className="mb-3 text-[13px] text-ink-500">
              {providers?.privacy.legalName || "Credovation Solutions Private Limited"} will use this connection only for:
            </p>
            <ul className="space-y-2">
              {info.purposes.map((p) => (
                <li key={p.key}>
                  <label className="flex cursor-pointer gap-3 rounded-xl border border-ink-400/15 p-3 hover:bg-hive-50/50">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-hive-700" checked={ticked.includes(p.key)} onChange={(e) => setTicked(e.target.checked ? [...ticked, p.key] : ticked.filter((k) => k !== p.key))} />
                    <span>
                      <span className="block text-sm font-semibold text-ink-900">{p.label}</span>
                      <span className="text-[13px] text-ink-500">{p.detail}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-500">
            You can withdraw consent at any time with <b>Disconnect</b> on this connector — the stored login is deleted immediately. Questions or grievances: {providers?.privacy.officer || "Grievance Officer"},{" "}
            <a className="font-semibold text-hive-700" href={`mailto:${providers?.privacy.email}`}>
              {providers?.privacy.email}
            </a>{" "}
            ·{" "}
            <a className="font-semibold text-hive-700" href={providers?.privacyUrl || "/privacy"} target="_blank" rel="noreferrer noopener">
              Privacy Policy
            </a>{" "}
            · Notice {providers?.consentVersion}
          </p>
          <p className="text-[12.5px] text-ink-500">On {info.platform}’s screen, keep every permission box ticked{info.provider === "meta" ? " and select your Pages" : ""} — leads can’t be received without them.</p>
          {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        </div>
      )}

      {step === "wait" && (
        <div className="space-y-4 py-4 text-center">
          {err ? <XCircle className="mx-auto h-10 w-10 text-red-500" /> : <Loader2 className="mx-auto h-10 w-10 animate-spin text-hive-600" />}
          <p className="font-semibold text-ink-900">{err ? "Not connected" : `Waiting for you to sign in to ${info.platform}…`}</p>
          {err ? <p className="text-sm text-red-700">{err}</p> : <p className="text-sm text-ink-500">Finish in the window that opened, then come back here.</p>}
          {(blocked || err) && url && (
            <a href={url} target="credoone-sso" rel="noopener" className="btn-secondary inline-flex" onClick={() => setErr("")}>
              {err ? "Try again" : "Open the sign-in window"} <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {blocked && !err && <p className="text-xs text-ink-500">Your browser blocked the popup — use the button above, or allow popups for this site.</p>}
        </div>
      )}

      {step === "pick" && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 rounded-xl bg-hive-50 px-3 py-2 text-sm text-hive-900">
            <CheckCircle2 className="h-4 w-4" /> Signed in{data?.account?.name ? ` as ${data.account.name}` : ""}. Consent recorded.
          </p>
          {type === "google_sheets" ? (
            <>
              <Field label="Google Sheet link" required hint="Google Forms: open the form → Responses → Link to Sheets, then paste that sheet’s link here.">
                <div className="flex gap-2">
                  <input className="input" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
                  <Btn variant="secondary" loading={busy && !sheet} disabled={sheetUrl.length < 20} onClick={findTabs}>
                    Check
                  </Btn>
                </div>
              </Field>
              {sheet && (
                <>
                  <Field label={`Tab in “${sheet.title}”`} required hint="The first row must be the column headings (Name, Phone, Email…).">
                    <select className="input" value={tab} onChange={(e) => setTab(e.target.value)}>
                      {sheet.tabs.map((t: string) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={importExisting} onChange={(e) => setImportExisting(e.target.checked)} /> Also import the rows already in the sheet (up to 1,000 at a time)
                  </label>
                </>
              )}
            </>
          ) : (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-900">Choose the {info.pick} that send leads</p>
              {items.length ? (
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {items.map((i) => (
                    <li key={i.id}>
                      <label className={`flex gap-3 rounded-xl border border-ink-400/15 p-3 ${i.disabled ? "opacity-60" : "cursor-pointer hover:bg-hive-50/50"}`}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-hive-700" disabled={!!i.disabled} checked={sel.includes(i.id)} onChange={(e) => setSel(e.target.checked ? [...sel, i.id] : sel.filter((x) => x !== i.id))} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink-900">{i.name}</span>
                          <span className="text-xs text-ink-500">{i.disabled || i.detail}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-ink-400/30 p-4 text-sm text-ink-500">{data?.choices?.note || "Nothing to connect was found for this login."}</p>
              )}
            </div>
          )}
          {!connectorId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Connector name" hint="Optional">
                <input className="input" placeholder={label} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Campaign name" hint="Optional — otherwise the ad’s campaign">
                <input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-3 py-2">
          <p className="flex items-center gap-2 text-base font-bold text-hive-800">
            <CheckCircle2 className="h-5 w-5" /> {connectorId ? "Reconnected" : "Connected"} — {result.name}
          </p>
          {result.pages?.length > 0 && (
            <ul className="space-y-1 text-sm">
              {result.pages.map((p: any) => (
                <li key={p.name} className={p.subscribed ? "text-ink-700" : "text-amber-800"}>
                  {p.subscribed ? "✓" : "!"} {p.name}: {p.subscribed ? "new leads arrive in seconds" : `real-time not available (${p.error || "not subscribed"}) — leads are fetched every 15 minutes`}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-ink-500">
            First fetch:{" "}
            {result.firstRun?.ok === false ? <span className="text-red-700">{result.firstRun.error}</span> : `${result.firstRun?.found ?? 0} found · ${result.firstRun?.created ?? 0} new lead(s)`}. After this, leads keep coming in automatically
            {type === "google_sheets" ? " (new rows every 15 minutes)" : ""}.
          </p>
        </div>
      )}
    </Modal>
  );
}

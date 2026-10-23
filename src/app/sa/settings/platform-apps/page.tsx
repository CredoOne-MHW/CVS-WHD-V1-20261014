"use client";
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, FlaskConical, KeyRound, Mail, Save, ShieldCheck, Trash2, CheckCircle2, XCircle, Facebook, Linkedin, Sheet } from "lucide-react";
import Link from "next/link";
import { api, fmtDate } from "@/lib/api";
import { PageHeader, Badge, Btn, Field, Spinner, Confirm, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";

const ICON: Record<string, any> = { meta: Facebook, linkedin: Linkedin, google: Sheet };
const USED_BY: Record<string, { types: string[]; label: string }> = {
  meta: { types: ["facebook_leads", "instagram_leads"], label: "Facebook Lead Ads · Instagram Lead Ads" },
  linkedin: { types: ["linkedin_leads"], label: "LinkedIn Lead Gen Forms" },
  google: { types: ["google_sheets"], label: "Google Sheets / Forms" },
};

function CopyLine({ label, value }: { label: string; value?: string }) {
  const [ok, setOk] = useState(false);
  if (!value) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink-500">{label}</p>
      <div className="flex items-center gap-1 rounded-xl border border-ink-400/20 bg-hive-50/50 pl-3">
        <code className="mono flex-1 overflow-x-auto whitespace-nowrap py-2 text-[12.5px]">{value}</code>
        <button
          type="button"
          className="btn-ghost shrink-0"
          aria-label={`Copy ${label}`}
          onClick={() => {
            navigator.clipboard.writeText(value);
            setOk(true);
            setTimeout(() => setOk(false), 1200);
          }}
        >
          {ok ? <Check className="h-4 w-4 text-hive-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function AppCard({ a, used, onChanged, canEdit }: { a: any; used: Record<string, number>; onChanged: () => void; canEdit: boolean }) {
  const [id, setId] = useState(a.clientId);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState("");
  const [test, setTest] = useState<any>(a.lastTest || null);
  const [del, setDel] = useState(false);
  const toast = useToast();
  const Icon = ICON[a.provider] || KeyRound;
  const n = USED_BY[a.provider].types.reduce((s, t) => s + (used[t] || 0), 0);

  async function save() {
    setBusy("save");
    try {
      await api(`/sa/platform-apps/${a.provider}`, { method: "PUT", body: { clientId: id, clientSecret: secret } });
      setSecret("");
      toast("ok", `${a.label} saved — click Test`);
      setTest(null);
      onChanged();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }
  async function runTest() {
    setBusy("test");
    try {
      setTest(await api(`/sa/platform-apps/${a.provider}/test`, { method: "POST" }));
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-hive-50 text-hive-700">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-ink-900">{a.label}</h2>
          <p className="text-sm text-ink-500">Used by: {USED_BY[a.provider].label}</p>
        </div>
        {a.configured ? <Badge color="green">Enabled{n ? ` · ${n} connected` : ""}</Badge> : <Badge color="honey">Not set — companies see “Not enabled yet”</Badge>}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={a.idLabel} required>
          <input className="input mono" value={id} disabled={!canEdit} onChange={(e) => setId(e.target.value)} placeholder={a.provider === "google" ? "1234…apps.googleusercontent.com" : ""} autoComplete="off" />
        </Field>
        <Field label={a.secretLabel} required={!a.configured} hint={a.configured ? `Saved: ${a.secretMasked} — leave blank to keep it` : "Stored encrypted; never shown again"}>
          <input className="input mono" type="password" value={secret} disabled={!canEdit} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>

      <div className="mt-4 space-y-3 rounded-2xl bg-[#f7f8f6] p-4">
        <p className="text-sm font-semibold text-ink-900">Register these in the {a.appLabel}</p>
        {a.callbacks.map((c: string) => (
          <CopyLine key={c} label={a.provider === "meta" ? "Valid OAuth Redirect URI (Facebook Login for Business › Settings)" : a.provider === "linkedin" ? "Authorized redirect URL (Auth tab)" : "Authorised redirect URI (OAuth client)"} value={c} />
        ))}
        {a.webhook && <CopyLine label={a.provider === "meta" ? "Webhooks › Page › Callback URL (field: leadgen)" : "Webhooks tab › Webhook URL"} value={a.webhook} />}
        {a.provider === "meta" && a.verifyToken && <CopyLine label="Webhooks › Verify token" value={a.verifyToken} />}
      </div>

      {test && (
        <div className={`mt-4 rounded-2xl border p-4 ${test.ok ? "border-hive-200 bg-hive-50/60" : "border-amber-200 bg-amber-50"}`}>
          <p className="mb-2 text-sm font-bold">{test.ok ? "Everything checks out" : "Fix the items marked below"}</p>
          <ul className="space-y-1.5">
            {test.checks.map((c: any, i: number) => (
              <li key={i} className="flex gap-2 text-[13.5px]">
                {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-hive-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
                <span>
                  <b>{c.label}:</b> <span className="break-all">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {test.at && <p className="mt-2 text-xs text-ink-500">Tested {fmtDate(test.at)}</p>}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <a href={a.console} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-sm font-semibold text-hive-700 hover:text-hive-900">
          Open developer console <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <div className="flex flex-wrap gap-2">
          {a.configured && canEdit && (
            <Btn variant="ghost" className="text-red-600" onClick={() => setDel(true)}>
              <Trash2 className="h-4 w-4" /> Remove
            </Btn>
          )}
          {a.configured && (
            <Btn variant="secondary" loading={busy === "test"} onClick={runTest}>
              <FlaskConical className="h-4 w-4" /> Test
            </Btn>
          )}
          {canEdit && (
            <Btn loading={busy === "save"} disabled={!id.trim() || (!a.configured && !secret)} onClick={save}>
              <Save className="h-4 w-4" /> Save
            </Btn>
          )}
        </div>
      </div>
      {a.updatedAt && (
        <p className="mt-2 text-right text-xs text-ink-400">
          Last saved {fmtDate(a.updatedAt)}
          {a.updatedBy ? ` by ${a.updatedBy}` : ""}
        </p>
      )}
      <Confirm
        open={del}
        danger
        title={`Remove the ${a.label} app?`}
        body={n ? `${n} connected connector(s) will stop receiving leads until an app is saved again.` : "Companies will see this channel as “Not enabled yet”."}
        confirmLabel="Remove"
        onClose={() => setDel(false)}
        onConfirm={async () => {
          await api(`/sa/platform-apps/${a.provider}`, { method: "DELETE" });
          setDel(false);
          setId("");
          setTest(null);
          onChanged();
        }}
      />
    </section>
  );
}

function PrivacyCard({ d, onChanged, canEdit }: { d: any; onChanged: () => void; canEdit: boolean }) {
  const [f, setF] = useState(d.compliance);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const placeholder = f.email === "support@credovation.tech";
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-hive-50 text-hive-700">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-ink-900">Privacy contact (DPDP Act)</h2>
          <p className="text-sm text-ink-500">Shown on every consent notice and on the Privacy, Terms and Data deletion pages that the platform apps link to.</p>
        </div>
        {placeholder && <Badge color="honey">Still the default email</Badge>}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Privacy / grievance email" required hint={placeholder ? "This is the default address — change it if privacy requests should go elsewhere" : undefined}>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" type="email" value={f.email} disabled={!canEdit} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
        </Field>
        <Field label="Grievance officer (name or title)" required>
          <input className="input" value={f.officer} disabled={!canEdit} onChange={(e) => setF({ ...f, officer: e.target.value })} />
        </Field>
        <Field label="Legal name" required>
          <input className="input" value={f.legalName} disabled={!canEdit} onChange={(e) => setF({ ...f, legalName: e.target.value })} />
        </Field>
        <Field label="Address" required>
          <input className="input" value={f.address} disabled={!canEdit} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 grid gap-3 rounded-2xl bg-[#f7f8f6] p-4 sm:grid-cols-3">
        {[
          ["Privacy Policy URL", d.pages.privacy],
          ["Terms of Service URL", d.pages.terms],
          ["Data deletion instructions URL", d.pages.dataDeletion],
        ].map(([l, v]) => (
          <div key={l} className="min-w-0">
            <CopyLine label={l} value={v} />
            <a href={v} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-hive-700">
              Preview <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-5 flex justify-end">
          <Btn
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { updatedAt, ...body } = f;
                await api("/sa/platform-apps/compliance", { method: "PUT", body });
                toast("ok", "Privacy contact saved — consent notices and policy pages now show it");
                onChanged();
              } catch (e: any) {
                toast("err", e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Save className="h-4 w-4" /> Save
          </Btn>
        </div>
      )}
    </section>
  );
}

export default function PlatformApps() {
  const [d, setD] = useState<any>(null);
  const perm = usePerm("platform_apps");
  const load = () => api("/sa/platform-apps").then(setD);
  useEffect(() => {
    load();
  }, []);
  if (!d)
    return (
      <div className="flex justify-center py-24 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  return (
    <>
      <PageHeader
        title="Platform Apps"
        subtitle="Credovation’s Meta, LinkedIn and Google apps. Enter them once — every company then connects its own accounts with a sign-in button, without ever seeing these keys."
        actions={
          <Link href="/sa/knowledgebase?tab=platform-apps" className="btn-secondary">
            Setup guide
          </Link>
        }
      />
      <div className="grid gap-5 xl:grid-cols-2">
        {d.apps.map((a: any) => (
          <AppCard key={`${a.provider}-${a.updatedAt || ""}`} a={a} used={d.used} onChanged={load} canEdit={perm.update} />
        ))}
        <PrivacyCard key={d.compliance.updatedAt || "c"} d={d} onChanged={load} canEdit={perm.update} />
      </div>
    </>
  );
}

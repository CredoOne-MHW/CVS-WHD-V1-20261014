"use client";
import { useEffect, useMemo, useState } from "react";
import { LogoDisc } from "@/components/LogoDisc";
import { useParams, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Btn } from "@/components/ui";
import { applyTheme } from "@shared/theme";
import { normalise, visible, validate, type FormSpec } from "@shared/formspec";
import { FormInput } from "@/components/FormInput";

/**
 * Hosted form for QR-code / campaign connectors. Posts to the connector's intake endpoint.
 *
 * The fields used to be written into this page. They now come from the connector, so a company can change
 * its own form without a release. A connector that has never been edited sends back the original four
 * fields and the original wording, so nothing about an existing form changes.
 */
export default function CampaignForm() {
  const key = (useParams() as { key: string } | null)?.key || "";
  const sp = useSearchParams();
  const [info, setInfo] = useState<any>(null);
  const [done, setDone] = useState(sp?.get("ok") === "1");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Record<string, any>>({ consent: true, _hp: "" });

  const spec: FormSpec = useMemo(() => normalise(info?.form), [info]);
  const fields = useMemo(() => visible(spec), [spec]);

  useEffect(() => {
    fetch(`/api/forms/${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        applyTheme(j.themeColor, j.accentColor);
        setInfo(j);
      })
      .catch(() => setErr("This form is no longer available."));
  }, [key]);

  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    /* the same check the server runs, so a problem is named before a round trip */
    const problem = validate(spec, f);
    if (problem) return setErr(problem);
    setBusy(true);
    setErr("");
    const utm = Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => k.startsWith("utm_")));
    const r = await fetch(`/api/intake/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${key}-${f.phone}-${new Date().toISOString().slice(0, 13)}` },
      body: JSON.stringify({ ...f, ...utm, consent: f.consent ? "yes" : "no", consent_text: spec.consentText }),
    });
    setBusy(false);
    if (r.ok) setDone(true);
    else setErr((await r.json().catch(() => ({}))).error || "Could not submit. Please try again.");
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-hive-50 px-4 py-10">
      <div className="card w-full max-w-md p-6 sm:p-8">
        {info?.logoUrl ? <LogoDisc src={info.logoUrl} name={info.company} size={80} className="mx-auto" /> : <div className="mx-auto h-20 w-20 rounded-full bg-hive-100" />}
        <h1 className="mt-4 text-center text-xl font-extrabold">{spec.heading || info?.company || "…"}</h1>
        <p className="text-center text-sm text-ink-500">{spec.intro || info?.campaign || info?.title}</p>
        {done ? (
          <div className="mt-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-hive-600" />
            <p className="mt-3 font-bold">{spec.thankYouTitle}</p>
            <p className="text-sm text-ink-500">{spec.thankYouText}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {fields.map((field) => (
              <FormInput key={field.key} field={field} value={f[field.key]} onChange={(v) => set(field.key, v)} />
            ))}
            <input className="hidden" tabIndex={-1} autoComplete="off" value={f._hp || ""} onChange={(e) => set("_hp", e.target.value)} aria-hidden />
            <label className="flex items-start gap-2 text-xs text-ink-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={!!f.consent} onChange={(e) => set("consent", e.target.checked)} />
              {spec.consentText}
              {spec.consentRequired && <span className="text-red-600">*</span>}
            </label>
            {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            <Btn type="submit" loading={busy} className="w-full py-3" disabled={!info}>
              {spec.submitLabel}
            </Btn>
          </form>
        )}
      </div>
    </div>
  );
}

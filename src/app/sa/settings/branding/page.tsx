"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Save } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader, Btn, Field, Spinner, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";
import { TemplatePicker } from "@/components/TemplatePicker";
import { TemplateThumb, LOGIN_TEMPLATES, type LoginBrand, type LoginTemplateKey } from "@/components/LoginTemplates";
import { themeVars, THEME_PRESETS } from "@shared/theme";

/** Super Admin › Settings › Platform Branding — the login page at the platform address (Super Admin and shared login). */
export default function PlatformBranding() {
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const perm = usePerm("branding");
  const toast = useToast();
  useEffect(() => {
    api("/sa/platform-branding").then(setF);
  }, []);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const vars = useMemo(() => (f ? themeVars(f.themeColor, f.accentColor) : {}), [f?.themeColor, f?.accentColor]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand: LoginBrand | null = f ? { kind: "platform", name: f.name, shortName: f.shortName, tagline: f.tagline, headline: f.headline, subheadline: f.subheadline, footerText: f.footerText, logoUrl: f.logoUrl } : null;

  async function save() {
    setBusy(true);
    try {
      const { loginTemplate, themeColor, accentColor, tagline, headline, subheadline, footerText } = f;
      setF(await api("/sa/platform-branding", { method: "PUT", body: { loginTemplate, themeColor, accentColor, tagline, headline, subheadline, footerText } }));
      toast("ok", "Platform login updated — live within a minute");
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!f || !brand)
    return (
      <div className="flex justify-center py-20 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  return (
    <>
      <PageHeader
        title="Platform Branding"
        subtitle="The login page at the platform address. Each company's own login is set in Company › Branding & domain."
        actions={
          <>
            <a href="/login" target="_blank" rel="noreferrer" className="btn btn-secondary">
              <ExternalLink className="h-4 w-4" /> Open login page
            </a>
            {perm.update && (
              <Btn loading={busy} onClick={save}>
                <Save className="h-4 w-4" /> Save
              </Btn>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
        <div className="space-y-6">
          <section className="card p-5">
            <h3 className="font-bold">Login page design</h3>
            <p className="mb-4 mt-1 text-xs text-ink-500">Pick one of 10 designs — each preview uses your logo, colours and texts.</p>
            <TemplatePicker value={f.loginTemplate as LoginTemplateKey} onChange={(k) => set("loginTemplate", k)} brand={brand} vars={vars} cols={3} />
          </section>
          <section className="card grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Theme color">
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Theme color" className="h-11 w-14 cursor-pointer rounded-xl border border-ink-400/25 bg-white p-1" value={f.themeColor} onChange={(e) => set("themeColor", e.target.value)} />
                <input className="input font-mono" value={f.themeColor} onChange={(e) => set("themeColor", e.target.value)} />
              </div>
              <div className="mt-2 flex gap-1.5">
                {THEME_PRESETS.map((c) => (
                  <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => set("themeColor", c)} className={`h-7 w-7 rounded-full ring-offset-2 ${f.themeColor === c ? "ring-2 ring-ink-900" : ""}`} style={{ background: c }} />
                ))}
              </div>
            </Field>
            <Field label="Accent color">
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Accent color" className="h-11 w-14 cursor-pointer rounded-xl border border-ink-400/25 bg-white p-1" value={f.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
                <input className="input font-mono" value={f.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
              </div>
            </Field>
            <Field label="Tagline">
              <input className="input" value={f.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </Field>
            <Field label="Footer text">
              <input className="input" value={f.footerText} onChange={(e) => set("footerText", e.target.value)} />
            </Field>
            <Field label="Headline" className="sm:col-span-2">
              <input className="input" value={f.headline} onChange={(e) => set("headline", e.target.value)} />
            </Field>
            <Field label="Sub-headline" className="sm:col-span-2">
              <textarea className="input min-h-[70px]" value={f.subheadline} onChange={(e) => set("subheadline", e.target.value)} />
            </Field>
          </section>
        </div>
        <div className="xl:sticky xl:top-4 xl:self-start">
          <p className="label">Live preview · {LOGIN_TEMPLATES.find((t) => t.key === f.loginTemplate)?.name}</p>
          <div style={vars as any} className="overflow-hidden rounded-2xl border border-ink-400/15 shadow-lift">
            <TemplateThumb template={f.loginTemplate} b={brand} />
          </div>
        </div>
      </div>
    </>
  );
}

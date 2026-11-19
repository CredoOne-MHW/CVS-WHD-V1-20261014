"use client";
import { useEffect, useState } from "react";
import { Globe2, ImagePlus, X, Building2, Palette, HardDrive, LayoutTemplate, Smartphone, Monitor, Type, Sparkles, FileCode2 } from "lucide-react";
import { api } from "@/lib/api";
import { Field, Btn, Badge, Spinner, useToast } from "@/components/ui";
import { themeVars, THEME_PRESETS } from "@shared/theme";
import { TemplatePicker } from "@/components/TemplatePicker";
import { LogoDisc } from "@/components/LogoDisc";
import { TemplateThumb, LOGIN_TEMPLATES, type LoginBrand } from "@/components/LoginTemplates";
import { SIDEBAR_STYLES, CORNER_STYLES, FONTS } from "@shared/platform";
import { DEFAULT_SUBTITLE } from "@shared/mobilebrand";

export type Kind = "logo" | "banner" | "favicon" | "appLogo" | "appBanner";
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
const bytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Which parts of the login page may take a colour of their own; "Auto" uses the design's. */
const LOGIN_PARTS: [string, string, string][] = [
  ["headline", "Headline", "Big line on the design side"],
  ["subheadline", "Sub-headline", "Line under the headline"],
  ["companyName", "Company name", "Next to the logo"],
  ["tagline", "Tagline", "Small line under the name"],
  ["signInTitle", "“Sign in” title", "Form heading"],
  ["formText", "Form text", "Helper and footer text"],
  ["button", "Button", "Sign-in button colour"],
  ["buttonText", "Button text", "Text on the button"],
];

/* ───────────────────────── Branding & domain ───────────────────────── */

export function BrandingTab({
  id,
  form,
  set,
  setB,
  base,
  previews,
  pick,
  removeImage,
  previewBrand,
  slugTouched,
  setSlugTouched,
}: {
  id?: string;
  form: any;
  set: (k: string, v: any) => void;
  setB: (k: string, v: any) => void;
  base: string;
  previews: Partial<Record<Kind, string>>;
  pick: (kind: Kind, f?: File | null) => void;
  removeImage: (kind: Kind) => void;
  previewBrand: LoginBrand;
  slugTouched: boolean;
  setSlugTouched: (v: boolean) => void;
}) {
  const [storage, setStorage] = useState<any>(null);
  useEffect(() => {
    if (id) api(`/sa/companies/${id}/storage`).then(setStorage).catch(() => setStorage({ enabled: false }));
  }, [id, form.s3Enabled]);

  const vars = themeVars(form.branding.themeColor || "#2f5c24", form.branding.accentColor || "#d9b52a");
  const colors = form.branding.loginColors || {};
  const appTheme = form.branding.appTheme || {};
  const code = (form.code || "CODE").toUpperCase();

  return (
    <div className="grid gap-7 xl:grid-cols-[1fr_400px]">
      <div className="space-y-7">
        <section>
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <Globe2 className="h-4 w-4 text-hive-700" /> Web address
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Platform address" required hint="Made from the company name — the support page is this address + /support">
              <div className="flex overflow-hidden rounded-xl border border-ink-400/25 bg-white focus-within:border-hive-500 focus-within:ring-4 focus-within:ring-hive-100">
                <input
                  className="min-w-0 flex-1 px-3.5 py-2.5 text-sm outline-none"
                  value={form.slug || ""}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set("slug", slugify(e.target.value));
                  }}
                />
                <span className="flex items-center whitespace-nowrap border-l border-ink-400/15 bg-hive-50 px-3 font-mono text-xs text-ink-500">.{base || "base-domain"}</span>
              </div>
            </Field>
            <Field label="Company’s own domain" hint="Optional, e.g. leads.yourcompany.com — DNS records appear after saving">
              <input className="input font-mono" placeholder="leads.yourcompany.com" value={form.customDomain || ""} onChange={(e) => set("customDomain", e.target.value.trim().toLowerCase())} />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <HardDrive className="h-4 w-4 text-hive-700" /> File storage (S3)
          </h3>
          <label className="flex items-start gap-3 rounded-2xl border border-ink-400/15 bg-white p-4">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={form.s3Enabled !== false} onChange={(e) => set("s3Enabled", e.target.checked)} />
            <span className="text-sm">
              <b>S3 storage required</b>
              <span className="block text-ink-500">
                {form.s3Enabled !== false ? (
                  <>
                    Everything this company owns lives under <span className="mono text-ink-700">{code}/</span> — <span className="mono">branding/</span> (logo, banner, favicon, sounds), <span className="mono">app/</span> (mobile builds pushed by GitHub Actions), <span className="mono">brain/</span> (AI knowledge), <span className="mono">dpdp/</span> (consent documents) and <span className="mono">&lt;Client Code&gt;/&lt;type&gt;/</span> (attachments).
                  </>
                ) : (
                  <>No S3 folder is created. Image uploads, AI knowledge files, sounds and attachments are off for this company. Tick this any time — the folder is created when you save.</>
                )}
              </span>
            </span>
          </label>
          {storage?.enabled && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {storage.areas.map((a: any) => (
                <div key={a.area} className="rounded-xl border border-ink-400/15 px-3 py-2 text-sm">
                  <p className="font-semibold capitalize">{a.area}</p>
                  <p className="mono text-[11px] text-ink-400">{a.prefix}</p>
                  <p className="text-xs text-ink-500">
                    {a.files} file(s) · {bytes(a.bytes)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={form.s3Enabled === false ? "pointer-events-none opacity-50" : ""}>
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <ImagePlus className="h-4 w-4 text-hive-700" /> Images
          </h3>
          <p className="-mt-1 mb-3 text-xs text-ink-500">
            Kept in S3 under <span className="mono">{code}/branding/…</span>. The logo is shown in a circle, the banner fills the design side of the login page.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["logo", "Company logo", "PNG/SVG · shown in a circle"],
                ["banner", "Side banner", "1600×1800 JPG/WebP"],
                ["favicon", "Favicon", "Optional · 64 px"],
              ] as [Kind, string, string][]
            ).map(([kind, label, hint]) => (
              <div key={kind}>
                <p className="label">{label}</p>
                <label className="group relative flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-ink-400/25 bg-[#fafbf9] text-center transition hover:border-hive-400 hover:bg-hive-50">
                  {previews[kind] && kind === "logo" ? (
                    <LogoDisc src={previews[kind]} name={form.name} size="72%" />
                  ) : previews[kind] ? (
                    <img src={previews[kind]} alt="" className={`h-full w-full ${kind === "banner" ? "object-cover" : "object-contain p-4"}`} />
                  ) : (
                    <>
                      <ImagePlus className="h-6 w-6 text-ink-400 group-hover:text-hive-600" />
                      <span className="mt-1.5 px-2 text-[11.5px] text-ink-500">{hint}</span>
                    </>
                  )}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" className="sr-only" onChange={(e) => pick(kind, e.target.files?.[0])} />
                </label>
                {previews[kind] && (
                  <button type="button" className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-red-600" onClick={() => removeImage(kind)}>
                    <X className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <Palette className="h-4 w-4 text-hive-700" /> Theme
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Theme colour" hint="Sidebar, buttons, charts and login — the whole app">
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Theme colour" className="h-11 w-14 cursor-pointer rounded-xl border border-ink-400/25 bg-white p-1" value={form.branding.themeColor} onChange={(e) => setB("themeColor", e.target.value)} />
                <input className="input font-mono" value={form.branding.themeColor} onChange={(e) => setB("themeColor", e.target.value)} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {THEME_PRESETS.map((c) => (
                  <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => setB("themeColor", c)} className={`h-7 w-7 rounded-full ring-offset-2 ${form.branding.themeColor === c ? "ring-2 ring-ink-900" : ""}`} style={{ background: c }} />
                ))}
              </div>
            </Field>
            <Field label="Accent colour" hint="Highlights and badges">
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Accent colour" className="h-11 w-14 cursor-pointer rounded-xl border border-ink-400/25 bg-white p-1" value={form.branding.accentColor} onChange={(e) => setB("accentColor", e.target.value)} />
                <input className="input font-mono" value={form.branding.accentColor} onChange={(e) => setB("accentColor", e.target.value)} />
              </div>
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-1 flex items-center gap-2 font-bold">
            <LayoutTemplate className="h-4 w-4 text-hive-700" /> Login page design
          </h3>
          <p className="mb-3 text-xs text-ink-500">10 designs, each shown with this company’s logo, colours and texts. The company’s login page uses the one you pick.</p>
          <TemplatePicker value={form.branding.loginTemplate} onChange={(k) => setB("loginTemplate", k)} brand={previewBrand} vars={vars as any} />
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <Building2 className="h-4 w-4 text-hive-700" /> Login page text
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name">
              <input className="input" placeholder={form.name} value={form.branding.shortName || ""} onChange={(e) => setB("shortName", e.target.value)} />
            </Field>
            <Field label="Company tagline">
              <input className="input" placeholder="Diagnostic Centre · Polyclinic · Elder Care" value={form.branding.tagline || ""} onChange={(e) => setB("tagline", e.target.value)} />
            </Field>
            <Field label="Headline" className="sm:col-span-2">
              <input className="input" value={form.branding.headline || ""} onChange={(e) => setB("headline", e.target.value)} />
            </Field>
            <Field label="Sub-headline" className="sm:col-span-2">
              <textarea className="input min-h-[70px]" value={form.branding.subheadline || ""} onChange={(e) => setB("subheadline", e.target.value)} />
            </Field>
            <Field label="Support email" hint="Shown under the sign-in form">
              <input className="input" type="email" value={form.branding.supportEmail || ""} onChange={(e) => setB("supportEmail", e.target.value)} />
            </Field>
            <Field label="Support phone">
              <input className="input" value={form.branding.supportPhone || ""} onChange={(e) => setB("supportPhone", e.target.value)} />
            </Field>
            <Field label="Footer text" className="sm:col-span-2">
              <input className="input" placeholder={`© ${new Date().getFullYear()} ${form.name || "Company"}`} value={form.branding.footerText || ""} onChange={(e) => setB("footerText", e.target.value)} />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-1 flex items-center gap-2 font-bold">
            <Palette className="h-4 w-4 text-hive-700" /> Login page colours
          </h3>
          <p className="mb-3 text-xs text-ink-500">Pick a colour for any part of the login page. “Auto” uses the design’s own colour. The preview updates as you change them.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LOGIN_PARTS.map(([key, label, hint]) => (
              <div key={key} className="rounded-2xl border border-ink-400/15 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{label}</p>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{colors[key] ? "set" : "auto"}</span>
                </div>
                <p className="mb-2 text-[11px] text-ink-500">{hint}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${label} colour`}
                    className="h-9 w-11 cursor-pointer rounded-lg border border-ink-400/25 bg-white p-1"
                    value={colors[key] || "#000000"}
                    onChange={(e) => setB("loginColors", { ...colors, [key]: e.target.value })}
                  />
                  <input className="input py-1.5 font-mono text-xs" placeholder="Auto" value={colors[key] || ""} onChange={(e) => setB("loginColors", { ...colors, [key]: e.target.value })} />
                  {colors[key] && (
                    <button
                      type="button"
                      aria-label={`Clear ${label}`}
                      className="text-ink-400 hover:text-red-600"
                      onClick={() => {
                        const n = { ...colors };
                        delete n[key];
                        setB("loginColors", n);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <MobileBrandSection form={form} setB={setB} previews={previews} pick={pick} removeImage={removeImage} />

        <section>
          <h3 className="mb-1 flex items-center gap-2 font-bold">
            <Smartphone className="h-4 w-4 text-hive-700" /> App themes
          </h3>
          <p className="mb-3 text-xs text-ink-500">Each app can follow the main brand or have its own look. New apps appear here automatically.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["web", "Web app", Monitor, "The company portal at its own address"],
                ["mobile", "Mobile app", Smartphone, "Android & iOS — set up on the Mobile App tab"],
              ] as const
            ).map(([key, label, Icon, hint]) => {
              const t = appTheme[key] || {};
              return (
                <div key={key} className="rounded-2xl border border-ink-400/15 p-4">
                  <p className="flex items-center gap-2 font-semibold">
                    <Icon className="h-4 w-4 text-hive-700" /> {label}
                  </p>
                  <p className="mb-3 text-xs text-ink-500">{hint}</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={t.useThemeColors !== false} onChange={(e) => setB("appTheme", { ...appTheme, [key]: { ...t, useThemeColors: e.target.checked } })} />
                    Follow the brand colours
                  </label>
                  <select className="input mt-2 py-1.5" value={t.theme || "classic"} onChange={(e) => setB("appTheme", { ...appTheme, [key]: { ...t, theme: e.target.value } })}>
                    {["classic", "midnight", "fresh", "glass", "ocean", "sunset", "forest", "royal"].map((x) => (
                      <option key={x} value={x} className="capitalize">
                        {x[0].toUpperCase() + x.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Live preview of the company login */}
      <div className="xl:sticky xl:top-0 xl:self-start">
        <p className="label">Live preview · {LOGIN_TEMPLATES.find((t) => t.key === form.branding.loginTemplate)?.name || "login page"}</p>
        <div style={vars as any} className="overflow-hidden rounded-2xl border border-ink-400/15 shadow-lift">
          <TemplateThumb template={form.branding.loginTemplate} b={previewBrand} />
        </div>
        <p className="mt-3 break-all font-mono text-xs text-ink-500">https://{form.customDomain || `${form.slug || "short-name"}.${base || "base-domain"}`}</p>
      </div>
    </div>
  );
}

/* ───────────────────────── White label ───────────────────────── */

export function WhiteLabelTab({ form, set }: { form: any; set: (k: string, v: any) => void }) {
  const w = form.whiteLabel || {};
  const setW = (k: string, v: any) => set("whiteLabel", { ...w, [k]: v });
  const names = w.appNames || {};

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-1 flex items-center gap-2 font-bold">
          <Palette className="h-4 w-4 text-hive-700" /> Brand visibility
        </h3>
        <p className="mb-3 text-xs text-ink-500">The company’s admin and staff only ever see this brand.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-2xl border border-ink-400/15 bg-white p-4">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={!!w.hideBranding} onChange={(e) => setW("hideBranding", e.target.checked)} />
            <span className="text-sm">
              <b>Hide platform branding</b>
              <span className="block text-ink-500">Removes “Powered by”, platform logo fallbacks and platform names from the app, e-mails, exports and the mobile apps.</span>
            </span>
          </label>
          <Field label="Support link" hint="Where the Support button points (blank = support e-mail / phone)">
            <input className="input" placeholder="https://help.yourbrand.in" value={w.supportUrl || ""} onChange={(e) => setW("supportUrl", e.target.value)} />
          </Field>
        </div>
        <Field label="E-mail sender name" className="mt-4 sm:max-w-[420px]" hint="The name on e-mails the platform sends for this company">
          <input className="input" placeholder={form.branding?.shortName || form.name} value={w.emailSender || ""} onChange={(e) => setW("emailSender", e.target.value)} />
        </Field>
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-bold">
          <Type className="h-4 w-4 text-hive-700" /> App names
        </h3>
        <p className="mb-3 text-xs text-ink-500">Shown on home screens, window titles and the mobile app’s store listing.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Web app">
            <input className="input" placeholder="Leads" value={names.web || ""} onChange={(e) => setW("appNames", { ...names, web: e.target.value })} />
          </Field>
          <Field label="Mobile app">
            <input className="input" placeholder={form.branding?.shortName || form.name} value={names.mobile || ""} onChange={(e) => setW("appNames", { ...names, mobile: e.target.value })} />
          </Field>
          <Field label="Admin app">
            <input className="input" placeholder="Admin" value={names.admin || ""} onChange={(e) => setW("appNames", { ...names, admin: e.target.value })} />
          </Field>
        </div>
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 font-bold">
          <LayoutTemplate className="h-4 w-4 text-hive-700" /> Look &amp; feel
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Sidebar">
            <select className="input" value={w.sidebar || "dark"} onChange={(e) => setW("sidebar", e.target.value)}>
              {SIDEBAR_STYLES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Corners">
            <select className="input" value={w.corners || "rounded"} onChange={(e) => setW("corners", e.target.value)}>
              {CORNER_STYLES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Font">
            <select className="input" value={w.font || FONTS[0]} onChange={(e) => setW("font", e.target.value)}>
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-bold">
          <FileCode2 className="h-4 w-4 text-hive-700" /> Custom CSS
        </h3>
        <p className="mb-3 text-xs text-ink-500">Added last on this company’s screens. Use it sparingly — a broken rule can hide a control.</p>
        <textarea className="input min-h-[140px] font-mono text-xs" placeholder=".page-watermark { display: none; }" value={w.customCss || ""} onChange={(e) => setW("customCss", e.target.value)} />
      </section>
    </div>
  );
}

/* ───────────────────────── Mobile app branding ───────────────────────── */

/**
 * How the company's phone app looks before anyone signs in.
 *
 * Until now this screen could not be changed at all: it drew two initials in a circle, the company name,
 * and one sentence written into the app's source. Anything else needed a new build.
 *
 * Everything here reaches an **installed** app without rebuilding it — the app asks for these values on
 * launch and caches them. The app icon and splash screen are the exception and stay on the Mobile App tab,
 * because those are part of the installed package and only a build can change them.
 */
function MobileBrandSection({
  form,
  setB,
  previews,
  pick,
  removeImage,
}: {
  form: any;
  setB: (k: string, v: any) => void;
  previews: Partial<Record<Kind, string>>;
  pick: (kind: Kind, f?: File | null) => void;
  removeImage: (kind: Kind) => void;
}) {
  const m = form.branding.mobile || {};
  const setM = (k: string, v: any) => setB("mobile", { ...m, [k]: v });
  const appName = form.whiteLabel?.appNames?.mobile || form.branding.shortName || form.name || "Leads";
  const logo = previews.appLogo || (m.useCompanyLogo === false ? undefined : previews.logo);

  return (
    <section>
      <h3 className="mb-1 flex items-center gap-2 font-bold">
        <Smartphone className="h-4 w-4 text-hive-700" /> Mobile app branding
      </h3>
      <p className="mb-3 text-xs text-ink-500">
        The app’s sign-in screen. Changes reach phones that already have the app — no new build needed. The app icon and splash screen are on the <b>Mobile App</b> tab, because only a build can change those.
      </p>

      <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["appLogo", "App logo", "Shown in a circle above the name"],
                ["appBanner", "Sign-in banner", "Optional strip across the top · 1200×600"],
              ] as [Kind, string, string][]
            ).map(([kind, label, hint]) => (
              <div key={kind}>
                <p className="label">{label}</p>
                <label className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-ink-400/25 bg-[#fafbf9] text-center transition hover:border-hive-400 hover:bg-hive-50 ${kind === "appBanner" ? "aspect-[2/1]" : "aspect-square"}`}>
                  {previews[kind] ? (
                    <img src={previews[kind]} alt="" className={`h-full w-full ${kind === "appBanner" ? "object-cover" : "object-contain p-4"}`} />
                  ) : (
                    <>
                      <ImagePlus className="h-6 w-6 text-ink-400 group-hover:text-hive-600" />
                      <span className="mt-1.5 px-2 text-[11.5px] text-ink-500">{hint}</span>
                    </>
                  )}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => pick(kind, e.target.files?.[0])} />
                </label>
                {previews[kind] && (
                  <button type="button" className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-red-600" onClick={() => removeImage(kind)}>
                    <X className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-ink-400/15 bg-white p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={m.useCompanyLogo !== false} onChange={(e) => setM("useCompanyLogo", e.target.checked)} />
            <span>
              <b>Use the company logo when there is no app logo</b>
              <span className="block text-ink-500">Untick to show the two-letter circle instead, which is what the app did before this existed.</span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Heading" hint={`Blank uses “${appName}”`}>
              <input className="input" placeholder={appName} value={m.heading || ""} onChange={(e) => setM("heading", e.target.value)} />
            </Field>
            <Field label="Footer note" hint="Small line above the version">
              <input className="input" placeholder="Optional" value={m.footerNote || ""} onChange={(e) => setM("footerNote", e.target.value)} />
            </Field>
            <Field label="Line under the heading" className="sm:col-span-2">
              <textarea className="input min-h-[60px]" placeholder={DEFAULT_SUBTITLE} value={m.subtitle || ""} onChange={(e) => setM("subtitle", e.target.value)} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={m.showVersion !== false} onChange={(e) => setM("showVersion", e.target.checked)} />
            Show the version and build number at the bottom
          </label>
        </div>

        {/* the screen itself, at the size it is drawn on a phone */}
        <div className="lg:sticky lg:top-0 lg:self-start">
          <p className="label">Sign-in screen</p>
          <div className="overflow-hidden rounded-[22px] border border-ink-400/20 bg-[#f6f7f5] shadow-lift" style={{ width: 240 }}>
            {previews.appBanner && <img src={previews.appBanner} alt="" className="h-20 w-full object-cover" />}
            <div className="px-4 pb-5 pt-6 text-center">
              {logo ? (
                <img src={logo} alt="" className="mx-auto h-16 w-16 rounded-full bg-white object-contain" />
              ) : (
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-lg font-extrabold text-white" style={{ background: form.branding.themeColor || "#2f5c24" }}>
                  {appName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <p className="mt-3 text-[15px] font-extrabold text-ink-900">{m.heading || appName}</p>
              <p className="mt-1 text-[10.5px] leading-snug text-ink-500">{m.subtitle || DEFAULT_SUBTITLE}</p>
              <div className="mt-4 space-y-2 rounded-2xl border border-ink-400/15 bg-white p-3 text-left">
                <p className="text-[9.5px] font-bold text-ink-700">E-mail</p>
                <div className="h-6 rounded-lg border border-ink-400/20" />
                <p className="text-[9.5px] font-bold text-ink-700">Password</p>
                <div className="h-6 rounded-lg border border-ink-400/20" />
                <div className="mt-1 flex h-7 items-center justify-center rounded-lg text-[10.5px] font-bold text-white" style={{ background: form.branding.themeColor || "#2f5c24" }}>
                  Sign in
                </div>
              </div>
              {!!m.footerNote && <p className="mt-2.5 text-[9.5px] text-ink-500">{m.footerNote}</p>}
              {m.showVersion !== false && <p className="mt-1.5 text-[9.5px] text-ink-400">v1.15.0 (build 1)</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

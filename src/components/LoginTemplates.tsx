"use client";
/**
 * Ten login page designs. Every design is driven by the brand's own colours (CSS variables → hive-* / honey-*),
 * logo, banner and texts set in Super Admin › Company › Branding & domain (or Settings › Platform branding).
 * The same components render the live login page and the scaled previews in the template picker, so a preview is exact.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AuraLogo } from "./Login3D";
import { LogoDisc } from "./LogoDisc";
import { CinematicScene, PreviewCtx } from "./cinema/CinematicScene";
import { Globe, MessageCircle, Megaphone, Search, Mail, PhoneCall, QrCode, Handshake, FileSpreadsheet, Braces, Sparkles, Zap, BellRing, ShieldCheck, LockKeyhole } from "lucide-react";

export interface LoginBrand {
  kind: "platform" | "company";
  name: string;
  shortName: string;
  tagline?: string;
  headline: string;
  subheadline: string;
  footerText?: string;
  logoUrl?: string;
  bannerUrl?: string;
  supportEmail?: string;
  supportPhone?: string;
}

export const LOGIN_TEMPLATES = [
  { key: "classic", name: "Classic Split", hint: "Brand panel with pattern + form" },
  { key: "photo", name: "Photo Panel", hint: "Your banner fills the brand side" },
  { key: "spotlight", name: "Spotlight Card", hint: "Card centred over full-screen banner" },
  { key: "aurora", name: "Aurora", hint: "Glowing logo halo + channel icons" },
  { key: "cinema", name: "Cinematic 3D", hint: "Real-time 3D neural brain · logo at the core, leads spark in, clients flow out" },
  { key: "minimal", name: "Minimal", hint: "Clean white page, accent hairline" },
  { key: "editorial", name: "Editorial", hint: "Form left, big type headline right" },
  { key: "mesh", name: "Gradient Mesh", hint: "Living colour blobs, glass card" },
  { key: "noir", name: "Noir Luxe", hint: "Dark, serif, accent gold lines" },
  { key: "showcase", name: "Showcase", hint: "Headline + feature tiles + form" },
  { key: "glass", name: "Frosted Glass", hint: "Banner with a docked glass panel" },
] as const;
export type LoginTemplateKey = (typeof LOGIN_TEMPLATES)[number]["key"];
export const TEMPLATE_KEYS = LOGIN_TEMPLATES.map((t) => t.key) as unknown as [LoginTemplateKey, ...LoginTemplateKey[]];

/** Older companies stored a 3-option layout; map it to the matching template. */
export function templateOf(b: { loginTemplate?: string; loginLayout?: string; kind?: string }): LoginTemplateKey {
  if (b.loginTemplate && LOGIN_TEMPLATES.some((t) => t.key === b.loginTemplate)) return b.loginTemplate as LoginTemplateKey;
  if (["orbit", "depth", "funnel"].includes(b.loginTemplate || "")) return "cinema"; // retired CSS-3D designs
  if (b.kind === "platform") return "cinema";
  return b.loginLayout === "banner" ? "photo" : b.loginLayout === "centered" ? "spotlight" : "classic";
}

/* ───────────── shared bits ───────────── */

const initials = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "•";

function Logo({ b, size = 56, ring = true, className = "" }: { b: LoginBrand; size?: number; ring?: boolean; className?: string }) {
  return <LogoDisc src={b.logoUrl} name={b.shortName || b.name} size={size} shadow={ring} className={className} />;
}
function Wordmark({ b, light, size = "md" }: { b: LoginBrand; light?: boolean; size?: "sm" | "md" | "lg" }) {
  const s = size === "lg" ? 64 : size === "sm" ? 40 : 52;
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <Logo b={b} size={s} ring />
      <div className="min-w-0">
        <p className={`truncate font-extrabold leading-tight tracking-tight ${size === "lg" ? "text-[26px]" : "text-[21px]"} ${light ? "text-white" : "text-ink-900"}`}>{b.shortName}</p>
        {b.tagline && <p className={`mt-0.5 truncate text-[11px] font-bold uppercase tracking-[.18em] ${light ? "text-white/60" : "text-ink-500"}`}>{b.tagline}</p>}
      </div>
    </div>
  );
}
function Help({ b, dark }: { b: LoginBrand; dark?: boolean }) {
  if (!b.supportEmail && !b.supportPhone) return null;
  const link = dark ? "font-semibold text-honey-300" : "font-semibold text-hive-700";
  return (
    <p className={`mt-7 text-center text-sm ${dark ? "text-white/60" : "text-ink-500"}`}>
      Trouble signing in? {b.supportEmail && <a className={link} href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>}
      {b.supportEmail && b.supportPhone && " · "}
      {b.supportPhone && <a className={link} href={`tel:${b.supportPhone}`}>{b.supportPhone}</a>}
    </p>
  );
}
function Secured({ b, dark }: { b: LoginBrand; dark?: boolean }) {
  return (
    <p className={`mt-8 flex items-center justify-center gap-1.5 text-center text-xs ${dark ? "text-white/40" : "text-ink-400"}`}>
      <LockKeyhole className="h-3.5 w-3.5" /> Secured with encrypted sessions{b.footerText ? ` · ${b.footerText}` : ""}
    </p>
  );
}
function Hexes({ className = "" }: { className?: string }) {
  const cells = [];
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) {
      const x = c * 104 + (r % 2) * 52;
      const y = r * 90;
      cells.push(<polygon key={`${r}-${c}`} points={`${x + 52},${y} ${x + 100},${y + 28} ${x + 100},${y + 84} ${x + 52},${y + 112} ${x + 4},${y + 84} ${x + 4},${y + 28}`} />);
    }
  return (
    <svg aria-hidden viewBox="0 0 560 480" className={`pointer-events-none absolute fill-none stroke-honey-300 ${className}`} strokeWidth="5">
      {cells}
    </svg>
  );
}
const CHANNELS = [
  { Icon: Globe, label: "Website" },
  { Icon: MessageCircle, label: "WhatsApp" },
  { Icon: Megaphone, label: "Meta Ads" },
  { Icon: Search, label: "Google Ads" },
  { Icon: Mail, label: "Email" },
  { Icon: PhoneCall, label: "Calls / IVR" },
  { Icon: QrCode, label: "QR Codes" },
  { Icon: Handshake, label: "Partners" },
  { Icon: FileSpreadsheet, label: "Excel / CSV" },
  { Icon: Braces, label: "REST API" },
];
/** Banner if uploaded, otherwise a rich gradient in the brand colours. */
function Backdrop({ b, overlay = "bg-gradient-to-br from-hive-950/85 via-hive-900/60 to-hive-800/40" }: { b: LoginBrand; overlay?: string }) {
  return (
    <>
      {b.bannerUrl ? (
        <img src={b.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(90% 80% at 15% 10%, rgb(var(--brand-500)) 0%, rgb(var(--brand-800)) 45%, rgb(var(--brand-950)) 100%)" }}>
          <Hexes className="-right-16 -top-10 h-[640px] w-[740px] opacity-[.12]" />
        </div>
      )}
      <div aria-hidden className={`absolute inset-0 ${overlay}`} />
    </>
  );
}

/* ───────────── the 10 designs ─────────────
 * Every design fills var(--lp-h) (100dvh on the page, a fixed height in previews) and stacks on small screens. */

type P = { b: LoginBrand; form: ReactNode; darkForm: ReactNode };
const H = "min-h-[var(--lp-h)]";

function Classic({ b, form }: P) {
  return (
    <div className={`grid ${H} bg-[#f6f7f5] lg:grid-cols-[1.05fr_1fr]`}>
      <section className="relative hidden flex-col justify-between overflow-hidden bg-hive-800 p-14 text-white lg:flex">
        <Hexes className="-right-10 -top-16 h-[620px] w-[720px] opacity-[.13]" />
        <div className="relative"><Wordmark b={b} light /></div>
        <div className="relative max-w-[560px]">
          <h1 className="text-[44px] font-extrabold leading-[1.1] tracking-tight">{b.headline}</h1>
          <p className="mt-5 text-[17px] leading-relaxed text-white/80">{b.subheadline}</p>
        </div>
        <p className="relative text-[15px] text-white/70">{b.footerText || b.tagline}</p>
      </section>
      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-[440px]">
          <div className="mb-10 lg:hidden"><Wordmark b={b} /></div>
          {form}
          <Help b={b} />
          <Secured b={b} />
        </div>
      </section>
    </div>
  );
}

function Photo({ b, form }: P) {
  return (
    <div className={`grid ${H} bg-white lg:grid-cols-[1.15fr_1fr]`}>
      <section className="relative hidden flex-col justify-end overflow-hidden p-14 text-white lg:flex">
        <Backdrop b={b} overlay="bg-gradient-to-b from-transparent via-hive-950/30 to-hive-950/90" />
        <div className="absolute left-14 top-12"><Wordmark b={b} light /></div>
        <div className="relative max-w-[600px]">
          <span className="inline-block h-1 w-14 rounded-full bg-honey-300" />
          <h1 className="mt-5 text-[46px] font-extrabold leading-[1.08] tracking-tight drop-shadow">{b.headline}</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-white/85">{b.subheadline}</p>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 lg:hidden"><Wordmark b={b} /></div>
          {form}
          <Help b={b} />
          <Secured b={b} />
        </div>
      </section>
    </div>
  );
}

function Spotlight({ b, form }: P) {
  return (
    <div className={`relative grid ${H} place-items-center overflow-hidden px-5 py-12`}>
      <Backdrop b={b} />
      <div className="relative w-full max-w-[460px]">
        <div className="rounded-[28px] bg-white/95 p-8 shadow-2xl ring-1 ring-black/5 backdrop-blur sm:p-10">
          <div className="mb-8"><Wordmark b={b} /></div>
          {form}
          <Help b={b} />
        </div>
        <p className="mt-6 text-center text-sm text-white/75">{b.footerText}</p>
      </div>
    </div>
  );
}

function Aurora({ b, form }: P) {
  return (
    <div className={`grid ${H} bg-[#f3f4f8] lg:grid-cols-[1.05fr_1fr]`}>
      <section className="relative hidden flex-col items-center justify-center overflow-hidden px-10 py-10 text-white lg:flex" style={{ background: "radial-gradient(120% 90% at 50% 22%, rgb(var(--brand-500)) 0%, rgb(var(--brand-700)) 46%, rgb(var(--brand-950)) 100%)" }}>
        <div aria-hidden className="absolute inset-0 opacity-[.16]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.4) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        <div className="relative"><AuraLogo src={b.logoUrl} name={b.shortName} size={300} /></div>
        <h1 className="relative mt-8 text-center text-[42px] font-extrabold leading-[1.08] tracking-[-0.02em]">{b.headline}</h1>
        <p className="relative mt-3 max-w-[560px] text-center text-[16px] leading-relaxed text-white/75">{b.subheadline}</p>
        <ul className="relative mt-8 grid w-full max-w-[580px] grid-cols-5 gap-x-3 gap-y-4 rounded-[22px] border border-white/10 bg-white/[.05] px-5 py-5 backdrop-blur-sm">
          {CHANNELS.map(({ Icon, label }) => (
            <li key={label} className="flex flex-col items-center gap-1.5">
              <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-gradient-to-b from-white/[.16] to-white/[.04] ring-1 ring-white/15">
                <Icon className="h-5 w-5 text-white" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="whitespace-nowrap text-[11px] font-medium text-white/70">{label}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-10"><Wordmark b={b} size="lg" /></div>
          {form}
          <Help b={b} />
          <Secured b={b} />
        </div>
      </section>
    </div>
  );
}

/* ───────────── Cinematic 3D (WebGL) ───────────── */
function RightForm({ b, form }: { b: LoginBrand; form: ReactNode }) {
  return (
    <section className="flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-10"><Wordmark b={b} size="lg" /></div>
        {form}
        <Help b={b} />
        <Secured b={b} />
      </div>
    </section>
  );
}
const STORY = ["Leads from every source", "Clients, end to end", "AI intelligence"];
function Cinema({ b, form }: P) {
  const [phase, setPhase] = useState(0);
  return (
    <div className={`grid ${H} bg-[#f3f4f8] lg:grid-cols-[1.15fr_1fr]`}>
      <section className="relative hidden overflow-hidden bg-hive-950 text-white lg:block">
        <CinematicScene logoUrl={b.logoUrl} name={b.shortName} onPhase={setPhase} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-hive-950 via-hive-950/70 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-12 pb-12">
          <h1 className="text-center text-[40px] font-extrabold leading-[1.08] tracking-[-0.02em]">{b.headline}</h1>
          <p className="mx-auto mt-3 max-w-[540px] text-center text-[15px] leading-relaxed text-white/65">{b.subheadline}</p>
          <ol className="mx-auto mt-8 grid max-w-[580px] grid-cols-3 gap-3" aria-label="How it works">
            {STORY.map((label, i) => (
              <li key={label} className={`transition-colors duration-500 ${phase === i ? "text-white" : "text-white/40"}`}>
                <span className="block h-[2px] overflow-hidden rounded-full bg-white/15">
                  {phase === i && <span key={`${i}-${phase}`} className="cin-progress block h-full rounded-full bg-honey-300" />}
                </span>
                <span className="mt-2.5 flex items-baseline gap-2 text-[13px] font-semibold">
                  <span className="font-mono text-[11px] opacity-70">0{i + 1}</span> {label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <RightForm b={b} form={form} />
    </div>
  );
}

function Minimal({ b, form }: P) {
  return (
    <div className={`relative flex ${H} flex-col bg-white`}>
      <div aria-hidden className="h-1.5 w-full bg-gradient-to-r from-hive-700 via-hive-500 to-honey-300" />
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Wordmark b={b} size="sm" />
        {b.supportEmail && <a href={`mailto:${b.supportEmail}`} className="hidden text-sm font-semibold text-hive-700 sm:block">Need help?</a>}
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-[400px]">
          <p className="eyebrow mb-3 text-hive-600">{b.tagline || "Welcome back"}</p>
          {form}
          <p className="mt-10 border-t border-ink-400/10 pt-6 text-center text-[13px] leading-relaxed text-ink-500">{b.subheadline}</p>
        </div>
      </main>
      <footer className="px-6 pb-6 text-center text-xs text-ink-400">{b.footerText}</footer>
    </div>
  );
}

function Editorial({ b, form }: P) {
  return (
    <div className={`grid ${H} bg-white lg:grid-cols-[1fr_1.15fr]`}>
      <section className="flex flex-col justify-between px-6 py-10 sm:px-14">
        <Wordmark b={b} size="sm" />
        <div className="mx-auto w-full max-w-[420px] py-10">
          {form}
          <Help b={b} />
        </div>
        <p className="text-xs text-ink-400">{b.footerText}</p>
      </section>
      <section className="relative hidden overflow-hidden bg-hive-50 lg:flex lg:flex-col lg:justify-center lg:px-16">
        <span aria-hidden className="absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-honey-100" />
        <span aria-hidden className="absolute -bottom-32 left-10 h-[360px] w-[360px] rounded-full border-[40px] border-hive-100" />
        <p className="eyebrow relative text-hive-600">{b.shortName}</p>
        <h1 className="relative mt-6 max-w-[640px] text-[64px] font-extrabold leading-[.98] tracking-[-0.035em] text-hive-900">{b.headline}</h1>
        <span aria-hidden className="relative mt-8 h-1.5 w-24 rounded-full bg-honey-500" />
        <p className="relative mt-8 max-w-[520px] text-[18px] leading-relaxed text-ink-700">{b.subheadline}</p>
      </section>
    </div>
  );
}

function Mesh({ b, darkForm }: P) {
  return (
    <div className={`relative grid ${H} place-items-center overflow-hidden bg-hive-950 px-5 py-12`}>
      <span aria-hidden className="lp-blob absolute -left-24 -top-24 h-[480px] w-[480px] rounded-full bg-hive-500/70 blur-[90px]" />
      <span aria-hidden className="lp-blob lp-blob-2 absolute -bottom-32 -right-16 h-[520px] w-[520px] rounded-full bg-honey-500/50 blur-[100px]" />
      <span aria-hidden className="lp-blob lp-blob-3 absolute left-1/2 top-1/3 h-[340px] w-[340px] rounded-full bg-hive-300/40 blur-[90px]" />
      <div aria-hidden className="absolute inset-0 opacity-[.07]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      <div className="relative grid w-full max-w-[980px] items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div className="hidden text-white lg:block">
          <Wordmark b={b} light size="lg" />
          <h1 className="mt-10 text-[48px] font-extrabold leading-[1.05] tracking-tight">{b.headline}</h1>
          <p className="mt-5 text-[17px] leading-relaxed text-white/75">{b.subheadline}</p>
        </div>
        <div className="rounded-[28px] border border-white/15 bg-white/10 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
          <div className="mb-8 lg:hidden"><Wordmark b={b} light /></div>
          {darkForm}
          <Help b={b} dark />
          <Secured b={b} dark />
        </div>
      </div>
    </div>
  );
}

function Noir({ b, darkForm }: P) {
  return (
    <div className={`grid ${H} bg-[#0d0f0c] text-white lg:grid-cols-[1.1fr_1fr]`}>
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 p-14 lg:flex">
        <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 20% 0%, rgb(var(--brand-800) / .55), transparent 70%)" }} />
        <div aria-hidden className="absolute left-14 right-14 top-[38%] h-px bg-gradient-to-r from-transparent via-honey-300/60 to-transparent" />
        <div className="relative"><Wordmark b={b} light /></div>
        <div className="relative max-w-[560px]">
          <h1 className="font-serif text-[52px] italic leading-[1.06] tracking-tight text-white">{b.headline}</h1>
          <p className="mt-6 text-[16px] leading-relaxed text-white/60">{b.subheadline}</p>
        </div>
        <div className="relative flex items-center gap-3 text-[13px] text-white/45">
          <span className="h-px w-10 bg-honey-300/70" /> {b.footerText || b.tagline}
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 lg:hidden"><Wordmark b={b} light /></div>
          {darkForm}
          <Help b={b} dark />
          <Secured b={b} dark />
        </div>
      </section>
    </div>
  );
}

const FEATURES = [
  { Icon: Zap, t: "Every channel, one inbox", d: "Website, WhatsApp, ads, calls and walk-ins" },
  { Icon: Sparkles, t: "Qualified automatically", d: "Scored, de-duplicated and routed" },
  { Icon: BellRing, t: "Follow-ups on time", d: "Reminders and WhatsApp nudges" },
];
function Showcase({ b, form }: P) {
  return (
    <div className={`grid ${H} bg-[#f6f7f5] lg:grid-cols-[1.2fr_1fr]`}>
      <section className="relative hidden flex-col justify-center overflow-hidden bg-gradient-to-br from-hive-900 to-hive-700 px-16 py-12 text-white lg:flex">
        <Hexes className="-bottom-40 -left-24 h-[560px] w-[660px] opacity-[.08]" />
        <div className="relative"><Wordmark b={b} light /></div>
        <h1 className="relative mt-10 max-w-[600px] text-[40px] font-extrabold leading-[1.1] tracking-tight">{b.headline}</h1>
        <p className="relative mt-4 max-w-[560px] text-[16px] leading-relaxed text-white/75">{b.subheadline}</p>
        <div className="relative mt-10 grid max-w-[640px] grid-cols-3 gap-4">
          {FEATURES.map(({ Icon, t, d }) => (
            <div key={t} className="rounded-2xl border border-white/10 bg-white/[.06] p-4 backdrop-blur-sm">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-honey-300 text-hive-950"><Icon className="h-5 w-5" /></span>
              <p className="mt-3 text-[14px] font-bold leading-snug">{t}</p>
              <p className="mt-1 text-[12px] leading-snug text-white/60">{d}</p>
            </div>
          ))}
        </div>
        <div className="relative mt-8 flex items-center gap-2 text-[13px] text-white/60">
          <ShieldCheck className="h-4 w-4 text-honey-300" /> Private workspace · role-based access · audit trail
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-[420px] rounded-[28px] bg-white p-8 shadow-lift ring-1 ring-black/5 sm:p-10">
          <div className="mb-8 lg:hidden"><Wordmark b={b} /></div>
          {form}
          <Help b={b} />
        </div>
      </section>
    </div>
  );
}

function Glass({ b, darkForm }: P) {
  return (
    <div className={`relative flex ${H} overflow-hidden`}>
      <Backdrop b={b} overlay="bg-gradient-to-r from-hive-950/70 via-hive-900/30 to-transparent" />
      <section className="relative hidden flex-1 flex-col justify-end p-14 text-white lg:flex">
        <h1 className="max-w-[620px] text-[48px] font-extrabold leading-[1.06] tracking-tight drop-shadow-lg">{b.headline}</h1>
        <p className="mt-4 max-w-[560px] text-[17px] leading-relaxed text-white/85">{b.subheadline}</p>
      </section>
      <section className="relative flex w-full items-center justify-center border-l border-white/20 bg-white/10 px-6 py-12 backdrop-blur-2xl lg:w-[500px]">
        <div className="w-full max-w-[400px]">
          <div className="mb-10"><Wordmark b={b} light /></div>
          {darkForm}
          <Help b={b} dark />
          <Secured b={b} dark />
        </div>
      </section>
    </div>
  );
}

const DESIGNS: Record<LoginTemplateKey, (p: P) => JSX.Element> = { classic: Classic, photo: Photo, spotlight: Spotlight, aurora: Aurora, cinema: Cinema, minimal: Minimal, editorial: Editorial, mesh: Mesh, noir: Noir, showcase: Showcase, glass: Glass };
export const DARK_TEMPLATES: LoginTemplateKey[] = ["mesh", "noir", "glass"];

export function LoginTemplate({ template, b, form, darkForm }: { template: LoginTemplateKey; b: LoginBrand; form: ReactNode; darkForm?: ReactNode }) {
  const D = DESIGNS[template] || Classic;
  return <D b={b} form={form} darkForm={darkForm || form} />;
}

/* ───────────── static form for previews ───────────── */
export function PreviewForm({ dark }: { dark?: boolean }) {
  const field = dark ? "h-[52px] rounded-2xl border border-white/20 bg-white/10" : "h-[52px] rounded-2xl border border-ink-400/20 bg-white";
  return (
    <div>
      <h2 className={`text-[32px] font-extrabold tracking-tight ${dark ? "text-white" : "text-ink-900"}`}>Sign in</h2>
      <p className={`mt-1.5 text-[15px] ${dark ? "text-white/60" : "text-ink-500"}`}>Use the email and password from your administrator.</p>
      <p className={`mt-8 text-sm font-semibold ${dark ? "text-white/80" : "text-ink-700"}`}>Email</p>
      <div className={`mt-1.5 ${field}`} />
      <p className={`mt-5 text-sm font-semibold ${dark ? "text-white/80" : "text-ink-700"}`}>Password</p>
      <div className={`mt-1.5 ${field}`} />
      <div className={`mt-7 grid h-[54px] place-items-center rounded-2xl text-[15px] font-bold ${dark ? "bg-honey-300 text-hive-950" : "bg-gradient-to-b from-hive-600 to-hive-700 text-white"}`}>Sign in</div>
    </div>
  );
}

/** A real template rendered at desktop size and scaled down — used by the template picker. Fills its container's width. */
export function TemplateThumb({ template, b, width }: { template: LoginTemplateKey; b: LoginBrand; width?: number }) {
  const W = 1280;
  const Hh = 800;
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(width || 300);
  useEffect(() => {
    if (width || !box.current) return;
    const el = box.current;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 300));
    ro.observe(el);
    setW(el.clientWidth || 300);
    return () => ro.disconnect();
  }, [width]);
  const s = w / W;
  const dark = DARK_TEMPLATES.includes(template);
  return (
    <div ref={box} className="lp-preview relative w-full overflow-hidden" style={{ width: width || "100%", height: Hh * s }} aria-hidden>
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left select-none" style={{ width: W, height: Hh, transform: `scale(${s})`, ["--lp-h" as any]: `${Hh}px` }}>
        <PreviewCtx.Provider value={true}>
          <LoginTemplate template={template} b={b} form={<PreviewForm />} darkForm={dark ? <PreviewForm dark /> : undefined} />
        </PreviewCtx.Provider>
      </div>
    </div>
  );
}

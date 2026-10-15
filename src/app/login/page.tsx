"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, Globe, MessageCircle, Megaphone, Search, PhoneCall, QrCode, Handshake, FileSpreadsheet, Braces, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { Btn, Spinner } from "@/components/ui";
import { applyTheme, setFavicon } from "@shared/theme";

interface Brand {
  kind: "platform" | "company";
  name: string;
  shortName: string;
  tagline?: string;
  headline: string;
  subheadline: string;
  footerText?: string;
  themeColor: string;
  accentColor: string;
  logoUrl?: string;
  bannerUrl?: string;
  faviconUrl?: string;
  loginLayout?: "split" | "banner" | "centered";
  active?: boolean;
  supportEmail?: string;
  supportPhone?: string;
}

/**
 * One /login for every address:
 *  - platform URL (mhw.credovation.tech, *.vercel.app) → CredoOne Super Admin login
 *  - <short>.<base> or the company's own domain → that company's branded login
 */
export default function Login() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [problem, setProblem] = useState<{ kind: "missing" | "down"; host: string; base?: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/public/branding", { credentials: "include" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.status === 404) return setProblem({ kind: "missing", host: j.host || window.location.host, base: j.baseDomain });
        if (!r.ok) return setProblem({ kind: "down", host: window.location.host });
        applyTheme(j.themeColor, j.accentColor);
        setFavicon(j.faviconUrl || j.logoUrl);
        document.title = j.kind === "platform" ? `${j.name} · ${j.tagline}` : `Sign in · ${j.shortName}`;
        setBrand(j);
      })
      .catch(() => setProblem({ kind: "down", host: window.location.host }));
  }, []);

  if (problem)
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="card max-w-lg p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-honey-500" />
          {problem.kind === "missing" ? (
            <>
              <h1 className="mt-3 text-xl font-extrabold">No workspace here yet</h1>
              <p className="mt-2 text-sm text-ink-500">
                Nothing is set up for <b>{problem.host}</b>. If you just mapped this domain, DNS may still be propagating — try again in a few minutes.
              </p>
              {problem.base && (
                <p className="mt-4 rounded-xl bg-hive-50 px-4 py-3 text-left text-[13px] text-ink-700">
                  Administrator: this server’s platform address is <b className="font-mono">{problem.base}</b>. If <b className="font-mono">{problem.host}</b> should open the Super Admin login, set <span className="font-mono">APP_BASE_DOMAIN={problem.host}</span> in Vercel and redeploy.
                </p>
              )}
            </>
          ) : (
            <>
              <h1 className="mt-3 text-xl font-extrabold">We can’t reach the server right now</h1>
              <p className="mt-2 text-sm text-ink-500">Please try again in a minute. If this keeps happening, check the database connection (MONGODB_URI) in Vercel.</p>
            </>
          )}
        </div>
      </div>
    );
  if (!brand)
    return (
      <div className="grid min-h-screen place-items-center text-ink-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  return brand.kind === "platform" ? <PlatformLogin b={brand} /> : <CompanyLogin b={brand} />;
}

/* ───────── shared form ───────── */
function SignInForm({ subtitle, variant }: { subtitle: string; variant: "platform" | "company" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ redirect: string }>("/auth/login", { body: { email, password } });
      window.location.href = r.redirect;
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <h2 className="text-[clamp(28px,4.2vh,34px)] font-extrabold tracking-tight text-ink-900">Sign in</h2>
      <p className="mt-1.5 text-[15px] text-ink-500">{subtitle}</p>

      <label className="mt-[4vh] block">
        <span className="label">Email</span>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className={`input h-[52px] rounded-2xl text-[15px] pl-11`} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </div>
      </label>
      <label className="mt-5 block">
        <span className="label">Password</span>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className={`input h-[52px] rounded-2xl pr-16 text-[15px] pl-11`} type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm font-semibold text-ink-700 hover:bg-hive-50" aria-label={show ? "Hide password" : "Show password"}>
            {variant === "platform" ? (show ? "Hide" : "Show") : show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>
      {err && <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">{err}</p>}
      <Btn type="submit" loading={busy} className="mt-7 h-[54px] w-full rounded-2xl text-[15px]">
        Sign in
      </Btn>
    </form>
  );
}

/* ───────── Platform (Super Admin) — CredoOne style ───────── */
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

/** Logo inside a breathing halo with an aura of light orbiting it. Sized from the viewport height so the page never scrolls. */
function AuraLogo({ src, alt }: { src?: string; alt: string }) {
  return (
    <div className="relative grid aspect-square w-[min(38vh,380px)] shrink-0 place-items-center">
      <span aria-hidden className="absolute inset-0 rounded-full border border-white/20" />
      <span aria-hidden className="aura-glow" />
      <span aria-hidden className="aura-comet" />
      <span aria-hidden className="aura-trail" />
      <span aria-hidden className="aura-breathe absolute inset-[14%] rounded-full" style={{ background: "radial-gradient(circle, #ffffff 0%, #f1f0ff 42%, rgba(200,194,255,.8) 64%, rgba(130,120,240,0) 78%)" }} />
      <img src={src} alt={alt} className="relative w-[64%] drop-shadow-[0_6px_18px_rgba(40,30,120,.25)]" />
    </div>
  );
}

function PlatformLogin({ b }: { b: Brand }) {
  return (
    <div className="grid min-h-[100dvh] bg-[#f3f4f8] lg:h-[100dvh] lg:grid-cols-[1.05fr_1fr] lg:overflow-hidden">
      <section
        className="relative hidden h-full min-h-0 flex-col items-center justify-center overflow-hidden px-10 py-[3.5vh] text-white lg:flex"
        style={{ background: "radial-gradient(120% 90% at 50% 22%, #4a4fa3 0%, #2f3180 46%, #1f1f5e 100%)" }}
      >
        <div aria-hidden className="absolute inset-0 opacity-[.16]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.4) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        <AuraLogo src={b.logoUrl} alt={b.name} />
        <h1 className="relative mt-[3.2vh] text-center text-[clamp(28px,4.6vh,46px)] font-extrabold leading-[1.08] tracking-[-0.02em]">{b.headline}</h1>
        <p className="relative mt-[1.4vh] max-w-[560px] text-center text-[clamp(14px,1.9vh,17px)] leading-relaxed text-white/75">{b.subheadline}</p>

        <div className="relative mt-[3vh] w-full max-w-[600px]">
          <p className="mb-[1.4vh] text-center text-[11px] font-bold uppercase tracking-[.22em] text-white/55">Captures leads from {CHANNELS.length} channels</p>
          <ul className="grid grid-cols-5 gap-x-3 gap-y-[1.6vh] rounded-[22px] border border-white/10 bg-white/[.05] px-5 py-[2vh] backdrop-blur-sm">
            {CHANNELS.map(({ Icon, label }) => (
              <li key={label} className="group flex flex-col items-center gap-[0.8vh]">
                <span className="grid h-[clamp(36px,5.4vh,50px)] w-[clamp(36px,5.4vh,50px)] place-items-center rounded-[14px] bg-gradient-to-b from-white/[.16] to-white/[.04] shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_8px_20px_-10px_rgba(0,0,0,.6)] ring-1 ring-white/15 transition group-hover:from-white/25 group-hover:ring-white/30">
                  <Icon className="h-[46%] w-[46%] text-white" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="whitespace-nowrap text-[clamp(10px,1.3vh,11.5px)] font-medium text-white/70">{label}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-[2.6vh] text-[13px] text-white/45">{b.footerText}</p>
      </section>

      <section className="flex min-h-[100dvh] items-center justify-center overflow-y-auto px-6 py-10 lg:min-h-0">
        <div className="w-full max-w-[440px]">
          <div className="mb-[5vh] flex items-center gap-3.5">
            <img src={b.logoUrl} alt="" className="h-14 w-auto" />
            <div>
              <p className="text-[28px] font-extrabold leading-none tracking-tight text-hive-700">{b.name}</p>
              <p className="mt-1.5 text-[11.5px] font-bold uppercase tracking-[.22em] text-ink-500">{b.tagline}</p>
            </div>
          </div>
          <SignInForm subtitle="Use your company or admin login." variant="platform" />
          <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-ink-400">
            <LockKeyhole className="h-3.5 w-3.5" /> Secured with encrypted sessions · {b.footerText}
          </p>
        </div>
      </section>
    </div>
  );
}

/* ───────── Company — themed, white-label ───────── */
function Hexes() {
  const cells = [];
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) {
      const x = c * 104 + (r % 2) * 52;
      const y = r * 90;
      cells.push(<polygon key={`${r}-${c}`} points={`${x + 52},${y} ${x + 100},${y + 28} ${x + 100},${y + 84} ${x + 52},${y + 112} ${x + 4},${y + 84} ${x + 4},${y + 28}`} />);
    }
  return (
    <svg aria-hidden viewBox="0 0 560 480" className="absolute -right-10 -top-16 h-[620px] w-[720px] fill-none stroke-honey-300 opacity-[.13]" strokeWidth="5">
      {cells}
    </svg>
  );
}

function CompanyLogin({ b }: { b: Brand }) {
  const layout = b.loginLayout || "split";
  const brandBlock = (
    <div className="flex items-center gap-4">
      <span className="grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-full bg-white p-1.5 shadow-lg shadow-black/20">
        {b.logoUrl ? <img src={b.logoUrl} alt="" className="h-full w-full rounded-full object-contain" /> : <span className="text-xl font-extrabold text-hive-700">{b.shortName.slice(0, 2).toUpperCase()}</span>}
      </span>
      <span className="text-2xl font-extrabold tracking-tight">{b.shortName}</span>
    </div>
  );
  const subtitle = "Use the email and password from your administrator.";
  const help = (b.supportEmail || b.supportPhone) && (
    <p className="mt-8 text-center text-sm text-ink-500">
      Trouble signing in? {b.supportEmail && <a className="font-semibold text-hive-700" href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>}
      {b.supportEmail && b.supportPhone && " · "}
      {b.supportPhone && <a className="font-semibold text-hive-700" href={`tel:${b.supportPhone}`}>{b.supportPhone}</a>}
    </p>
  );

  if (layout === "centered")
    return (
      <div className="relative grid min-h-screen place-items-center bg-hive-900 px-5 py-12">
        {b.bannerUrl ? <img src={b.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Hexes />}
        <div className="absolute inset-0 bg-gradient-to-br from-hive-950/85 via-hive-900/70 to-hive-800/60" />
        <div className="relative w-full max-w-[460px] rounded-[28px] bg-white/95 p-8 shadow-2xl backdrop-blur sm:p-10">
          <div className="mb-8 text-hive-800 [&_span.text-2xl]:text-ink-900">{brandBlock}</div>
          <SignInForm subtitle={subtitle} variant="company" />
          {help}
        </div>
      </div>
    );

  return (
    <div className="grid min-h-screen bg-[#f6f7f5] lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-hive-800 p-14 text-white lg:flex lg:flex-col lg:justify-between">
        {b.bannerUrl && layout === "banner" ? (
          <>
            <img src={b.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-hive-950/90 via-hive-900/55 to-hive-900/30" />
          </>
        ) : (
          <>
            <Hexes />
            {b.bannerUrl && <img src={b.bannerUrl} alt="" className="absolute bottom-0 right-0 h-[55%] w-[70%] rounded-tl-[48px] object-cover opacity-90 shadow-2xl" />}
          </>
        )}
        <div className="relative">{brandBlock}</div>
        <div className="relative max-w-[560px]">
          <h1 className="text-[46px] font-extrabold leading-[1.1] tracking-tight">{b.headline}</h1>
          <p className="mt-5 text-[17px] leading-relaxed text-white/80">{b.subheadline}</p>
        </div>
        <p className="relative text-[15px] text-white/70">{b.tagline || b.footerText}</p>
      </section>

      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-[460px]">
          <div className="mb-10 text-ink-900 lg:hidden">{brandBlock}</div>
          <SignInForm subtitle={subtitle} variant="company" />
          {help}
          {b.footerText && <p className="mt-12 text-center text-xs text-ink-400">{b.footerText}</p>}
        </div>
      </section>
    </div>
  );
}

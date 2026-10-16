"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, AlertTriangle } from "lucide-react";
import { LoginTemplate, templateOf, DARK_TEMPLATES } from "@/components/LoginTemplates";
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
  loginTemplate?: string;
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
        setFavicon(j.faviconUrl || j.logoUrl, { name: j.shortName || j.name, color: j.themeColor });
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
  const t = templateOf(brand);
  const subtitle = brand.kind === "platform" ? "Use your company or admin login." : "Use the email and password from your administrator.";
  return (
    <div style={{ ["--lp-h" as any]: "100dvh" }}>
      <LoginTemplate template={t} b={brand} form={<SignInForm subtitle={subtitle} />} darkForm={DARK_TEMPLATES.includes(t) ? <SignInForm subtitle={subtitle} dark /> : undefined} />
    </div>
  );
}

/* ───────── shared form (light or dark surface) ───────── */
function SignInForm({ subtitle, dark }: { subtitle: string; dark?: boolean }) {
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
  const input = dark
    ? "h-[52px] w-full rounded-2xl border border-white/20 bg-white/10 pl-11 text-[15px] text-white placeholder:text-white/40 outline-none transition focus:border-honey-300 focus:ring-4 focus:ring-honey-300/20"
    : "input h-[52px] rounded-2xl pl-11 text-[15px]";
  const icon = `pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 ${dark ? "text-white/50" : "text-ink-400"}`;
  const label = dark ? "mb-1.5 block text-sm font-semibold text-white/80" : "label";

  return (
    <form onSubmit={submit} className="w-full">
      <h2 className={`text-[clamp(28px,4.2vh,34px)] font-extrabold tracking-tight ${dark ? "text-white" : "text-ink-900"}`}>Sign in</h2>
      <p className={`mt-1.5 text-[15px] ${dark ? "text-white/60" : "text-ink-500"}`}>{subtitle}</p>

      <label className="mt-8 block">
        <span className={label}>Email</span>
        <div className="relative">
          <Mail className={icon} />
          <input className={input} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </div>
      </label>
      <label className="mt-5 block">
        <span className={label}>Password</span>
        <div className="relative">
          <LockKeyhole className={icon} />
          <input className={`${input} pr-14`} type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" onClick={() => setShow(!show)} className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 ${dark ? "text-white/70 hover:bg-white/10" : "text-ink-700 hover:bg-hive-50"}`} aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>
      {err && <p className={`mt-4 rounded-xl px-3.5 py-2.5 text-sm font-medium ${dark ? "border border-red-300/30 bg-red-500/15 text-red-100" : "border border-red-100 bg-red-50 text-red-700"}`}>{err}</p>}
      {dark ? (
        <button type="submit" disabled={busy} className="mt-7 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-honey-300 text-[15px] font-bold text-hive-950 shadow-lg transition hover:brightness-105 disabled:opacity-70">
          {busy && <Spinner className="h-4 w-4" />} Sign in
        </button>
      ) : (
        <Btn type="submit" loading={busy} className="mt-7 h-[54px] w-full rounded-2xl text-[15px]">
          Sign in
        </Btn>
      )}
    </form>
  );
}

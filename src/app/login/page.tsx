"use client";
import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { Btn } from "@/components/ui";

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "Wellness Hive";
const LOGO = process.env.NEXT_PUBLIC_BRAND_LOGO || "/wellness-hive-logo.jpeg";

/** One login page for every account. The server decides Super Admin vs Company Admin from the credentials. */
export default function Login() {
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
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-hive-800 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <svg className="absolute -right-24 -top-24 h-[520px] w-[520px] opacity-[.09]" viewBox="0 0 200 200" aria-hidden>
          {[0, 1, 2, 3].flatMap((r) =>
            [0, 1, 2, 3].map((c) => {
              const x = c * 52 + (r % 2) * 26;
              const y = r * 45;
              return <polygon key={`${r}${c}`} points={`${x + 26},${y} ${x + 50},${y + 13} ${x + 50},${y + 39} ${x + 26},${y + 52} ${x + 2},${y + 39} ${x + 2},${y + 13}`} fill="none" stroke="#f0d75d" strokeWidth="2" />;
            })
          )}
        </svg>
        <div className="flex items-center gap-3">
          <img src={LOGO} alt="" className="h-14 w-14 rounded-full bg-white object-cover" />
          <span className="text-xl font-extrabold">{BRAND}</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-extrabold leading-tight">Every enquiry, captured. Every follow-up, on time.</h1>
          <p className="mt-4 text-hive-100/80">Website, WhatsApp, Meta and Google ads, calls and walk-ins land in one pipeline — qualified, routed and tracked to conversion.</p>
        </div>
        <p className="text-sm text-hive-100/60">Diagnostic Centre · Polyclinic · Elder Care</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <img src={LOGO} alt={BRAND} className="mx-auto mb-6 h-24 w-24 rounded-full lg:hidden" />
          <h2 className="text-2xl font-extrabold text-ink-900">Sign in</h2>
          <p className="mt-1 text-sm text-ink-500">Use the email and password from your administrator.</p>

          <label className="mt-8 block">
            <span className="label">Email</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input className="input pl-10" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
          </label>
          <label className="mt-4 block">
            <span className="label">Password</span>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input className="input px-10" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          {err && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{err}</p>}
          <Btn type="submit" loading={busy} className="mt-6 w-full py-3">
            Sign in
          </Btn>
        </form>
      </section>
    </div>
  );
}

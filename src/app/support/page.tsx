"use client";
import { useCallback, useEffect, useState } from "react";
import { LifeBuoy, LogOut, RefreshCw, Send, CheckCircle2, Clock3, ChevronDown, AlertTriangle, Phone, Mail, Inbox } from "lucide-react";
import { applyTheme, setFavicon } from "@shared/theme";
import { Spinner } from "@/components/ui";

type Info = { name: string; shortName: string; tagline?: string; logoUrl?: string; faviconUrl?: string; themeColor: string; accentColor: string; supportEmail?: string; supportPhone?: string; categories: string[] };
type Ticket = { _id: string; ticketNo: string; category: string; description: string; status: string; createdAt: string; updatedAt: string; history: { at: string; to: string; note?: string }[] };

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-sky-50 text-sky-800 ring-sky-200",
  "In Progress": "bg-amber-50 text-amber-800 ring-amber-200",
  "On Hold": "bg-slate-100 text-slate-700 ring-slate-200",
  Resolved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Closed: "bg-slate-100 text-slate-600 ring-slate-200",
};
const CAT_HINT: Record<string, string> = { Support: "Something isn't working or you need help", Request: "Ask for a new service, change or document", Grievance: "Tell us about a complaint" };
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Keeps the ?c=<short name> used on the platform address / local testing. */
const suffix = () => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("c") ? `?c=${encodeURIComponent(new URLSearchParams(window.location.search).get("c")!)}` : "");
const store = {
  get: () => {
    try {
      return JSON.parse(sessionStorage.getItem("support") || "null");
    } catch {
      return null;
    }
  },
  set: (v: any) => {
    try {
      v ? sessionStorage.setItem("support", JSON.stringify(v)) : sessionStorage.removeItem("support");
    } catch {}
  },
};

async function call<T = any>(path: string, opts: { method?: string; body?: any; token?: string } = {}): Promise<T> {
  const r = await fetch(`/api/public/support${path}${suffix()}`, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(opts.token ? { "x-support-token": opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Something went wrong (${r.status})`), { status: r.status });
  return j;
}

export default function SupportPortal() {
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState(false);
  const [session, setSession] = useState<{ token: string; client: { clientId: string; name: string } } | null>(null);

  useEffect(() => {
    call<Info>("/info")
      .then((i) => {
        applyTheme(i.themeColor, i.accentColor);
        setFavicon(i.faviconUrl || i.logoUrl, { name: i.shortName, color: i.themeColor });
        setInfo(i);
      })
      .catch(() => setMissing(true));
    setSession(store.get());
    // installable app on the support.<address> host
    if ("serviceWorker" in navigator && window.location.hostname.startsWith("support.")) navigator.serviceWorker.register("/support-sw.js").catch(() => undefined);
  }, []);

  if (missing)
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#f6f7f5] px-6 text-center">
        <div>
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
          <h1 className="mt-3 text-xl font-extrabold">No support page here</h1>
          <p className="mt-2 text-sm text-ink-500">Check the address you were given, or contact the company directly.</p>
        </div>
      </div>
    );
  if (!info)
    return (
      <div className="grid min-h-[100dvh] place-items-center text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const signOut = () => {
    store.set(null);
    setSession(null);
  };
  return (
    <div className="min-h-[100dvh] bg-[#f6f7f5] pb-[env(safe-area-inset-bottom)]">
      <header className="relative overflow-hidden bg-gradient-to-br from-hive-800 to-hive-950 px-5 pb-16 pt-[max(20px,env(safe-area-inset-top))] text-white">
        <div aria-hidden className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-honey-300/20 blur-3xl" />
        <div className="relative mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-white p-0.5 shadow-lg">
              {info.logoUrl ? <img src={info.logoUrl} alt="" className="h-full w-full rounded-full object-contain" /> : <LifeBuoy className="h-6 w-6 text-hive-700" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[17px] font-extrabold leading-tight">{info.shortName}</p>
              <p className="text-[11px] font-bold uppercase tracking-[.16em] text-white/60">Client support</p>
            </div>
          </div>
          {session && (
            <button onClick={signOut} className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20">
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
        <div className="relative mx-auto mt-7 max-w-2xl">
          <h1 className="text-[26px] font-extrabold leading-tight sm:text-[30px]">{session ? `Hi ${session.client.name} 👋` : "How can we help?"}</h1>
          <p className="mt-1 text-sm text-white/70">{session ? `Client ID ${session.client.clientId} · raise a request or follow up on one` : "Sign in with your Client ID to raise a request or check its status."}</p>
        </div>
      </header>
      <main className="relative mx-auto -mt-10 max-w-2xl px-4">
        {session ? (
          <Tickets info={info} session={session} onExpired={signOut} />
        ) : (
          <SignIn
            onDone={(s) => {
              store.set(s);
              setSession(s);
            }}
          />
        )}
        {(info.supportPhone || info.supportEmail) && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pb-8 text-sm text-ink-500">
            {info.supportPhone && (
              <a href={`tel:${info.supportPhone}`} className="flex items-center gap-1.5 font-semibold text-hive-700">
                <Phone className="h-4 w-4" /> {info.supportPhone}
              </a>
            )}
            {info.supportEmail && (
              <a href={`mailto:${info.supportEmail}`} className="flex items-center gap-1.5 font-semibold text-hive-700">
                <Mail className="h-4 w-4" /> {info.supportEmail}
              </a>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function SignIn({ onDone }: { onDone: (s: any) => void }) {
  const [clientId, setClientId] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      onDone(await call("/session", { body: { clientId, phone } }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="rounded-3xl bg-white p-6 shadow-lift ring-1 ring-black/5 sm:p-8">
      <label className="block">
        <span className="label">Client ID</span>
        <input className="input h-[52px] rounded-2xl font-mono text-[16px] uppercase tracking-wide" autoComplete="off" autoCapitalize="characters" required value={clientId} onChange={(e) => setClientId(e.target.value.toUpperCase())} placeholder="e.g. WHD-C0001" />
        <span className="mt-1 block text-xs text-ink-500">It's on your welcome message and invoices.</span>
      </label>
      <label className="mt-5 block">
        <span className="label">Registered mobile number</span>
        <input className="input h-[52px] rounded-2xl text-[16px]" inputMode="numeric" autoComplete="tel-national" required maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ""))} placeholder="10-digit mobile" />
      </label>
      {err && <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">{err}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary mt-6 h-[52px] w-full rounded-2xl text-[15px]">
        {busy ? <Spinner /> : null} Continue
      </button>
    </form>
  );
}

function Tickets({ info, session, onExpired }: { info: Info; session: { token: string; client: any }; onExpired: () => void }) {
  const [list, setList] = useState<Ticket[] | null>(null);
  const [cat, setCat] = useState(info.categories[0]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await call<Ticket[]>("/tickets", { token: session.token }));
    } catch (e: any) {
      if (e.status === 401) onExpired();
    }
  }, [session.token, onExpired]);
  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const t = await call("/tickets", { token: session.token, body: { category: cat, description: text } });
      setText("");
      setMsg({ ok: true, text: `Ticket ${t.ticketNo} raised. We'll update you on WhatsApp at every step.` });
      load();
    } catch (e: any) {
      if (e.status === 401) return onExpired();
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="rounded-3xl bg-white p-5 shadow-lift ring-1 ring-black/5 sm:p-7">
        <p className="text-[15px] font-extrabold text-ink-900">New request</p>
        <div role="radiogroup" aria-label="Support category" className="mt-4 grid grid-cols-3 gap-2">
          {info.categories.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cat === c}
              onClick={() => setCat(c)}
              className={`rounded-2xl border px-2 py-3 text-center text-sm font-bold transition ${cat === c ? "border-hive-600 bg-hive-50 text-hive-800 ring-2 ring-hive-100" : "border-ink-400/20 text-ink-700 hover:border-hive-300"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-500">{CAT_HINT[cat]}</p>
        <label className="mt-4 block">
          <span className="label">What do you need?</span>
          <textarea className="input min-h-[120px] rounded-2xl text-[15px]" required minLength={10} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the issue or request…" />
        </label>
        {msg && <p className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.ok && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}{msg.text}</p>}
        <button type="submit" disabled={busy || text.trim().length < 10} className="btn btn-primary mt-5 h-[50px] w-full rounded-2xl text-[15px]">
          {busy ? <Spinner /> : <Send className="h-4 w-4" />} Submit request
        </button>
      </form>

      <section className="rounded-3xl bg-white p-5 shadow-card ring-1 ring-black/5 sm:p-7">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-extrabold text-ink-900">My requests</p>
          <button onClick={load} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-semibold text-hive-700 hover:bg-hive-50" aria-label="Refresh">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        {!list ? (
          <div className="flex justify-center py-8 text-hive-700">
            <Spinner />
          </div>
        ) : !list.length ? (
          <div className="py-10 text-center text-sm text-ink-500">
            <Inbox className="mx-auto mb-2 h-7 w-7 text-ink-400" />
            No requests yet.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-ink-400/10">
            {list.map((t) => (
              <li key={t._id} className="py-3">
                <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === t._id ? null : t._id)} aria-expanded={open === t._id}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-bold text-ink-900">{t.ticketNo}</span>
                      <span className="rounded-full bg-hive-50 px-2 py-0.5 text-[11px] font-bold text-hive-800">{t.category}</span>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm text-ink-700">{t.description}</span>
                    <span className="mt-1 flex items-center gap-1 text-xs text-ink-500">
                      <Clock3 className="h-3.5 w-3.5" /> {when(t.createdAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${STATUS_STYLE[t.status] || STATUS_STYLE.Open}`}>{t.status}</span>
                    <ChevronDown className={`h-4 w-4 text-ink-400 transition ${open === t._id ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {open === t._id && (
                  <ol className="mt-3 space-y-2.5 border-l-2 border-hive-100 pl-4">
                    {t.history.map((h, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-semibold text-ink-900">{h.to}</span> <span className="text-xs text-ink-500">· {when(h.at)}</span>
                        {h.note && h.note !== "Ticket created" && <p className="text-ink-700">{h.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

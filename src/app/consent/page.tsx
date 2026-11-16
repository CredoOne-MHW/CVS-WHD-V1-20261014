"use client";
/**
 * The DPDP consent screen.
 *
 * A link the website, the apps and the CRM open before any personal data is collected. The notice must be
 * read to the end — Accept stays off until the page has been scrolled to the bottom and a sensible amount of
 * time has passed — and there is no Cancel: closing the window simply means nothing was accepted.
 *
 * Everything the screen measures (how far it was scrolled, how long it was open, when the end was reached)
 * is sent with the acceptance and checked again on the server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck, Check, ArrowDown, FileDown, Loader2 } from "lucide-react";
import { applyTheme } from "@shared/theme";

type Purpose = { key: string; label: string; required: boolean; description: string };

const VISITOR_KEY = "credoone.visitor";
function visitorId() {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return `v_${Math.random().toString(36).slice(2)}`; // private window — the acceptance is still recorded
  }
}

export default function ConsentPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [who, setWho] = useState({ name: "", email: "", phone: "" });
  const [pct, setPct] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [endAt, setEndAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const box = useRef<HTMLDivElement>(null);
  const opened = useRef(new Date());

  const qs = typeof window === "undefined" ? "" : window.location.search;
  const params = useMemo(() => new URLSearchParams(qs), [qs]);

  useEffect(() => {
    const c = params.get("c");
    fetch(`/api/public/consent${c ? `?c=${encodeURIComponent(c)}` : ""}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || "Not found")))))
      .then((x) => {
        setD(x);
        setPicked(x.purposes.filter((p: Purpose) => p.required).map((p: Purpose) => p.key));
        applyTheme(x.company.themeColor, x.company.accentColor);
        document.title = `${x.notice.title} · ${x.company.shortName || x.company.name}`;
      })
      .catch((e) => setErr(e.message));
  }, [params]);

  // time on the page
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // how far the notice has been read
  const onScroll = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const p = max <= 4 ? 100 : Math.min(100, Math.round((el.scrollTop / max) * 100));
    setPct((old) => (p > old ? p : old));
    if (p >= (d?.rules?.minScrollPct ?? 98)) setEndAt((x) => x || new Date());
  }, [d]);
  useEffect(() => {
    // a notice shorter than the window is read as soon as it is shown
    const el = box.current;
    if (el && el.scrollHeight - el.clientHeight <= 4) {
      setPct(100);
      setEndAt((x) => x || new Date());
    }
  }, [d]);

  const rules = d?.rules || { minScrollPct: 98, minSeconds: 5 };
  const read = pct >= rules.minScrollPct && seconds >= rules.minSeconds;
  const need = d?.purposes?.filter((p: Purpose) => p.required).every((p: Purpose) => picked.includes(p.key));
  const canAccept = read && need && !busy;

  async function accept() {
    setBusy(true);
    setErr("");
    try {
      const c = params.get("c");
      const r = await fetch(`/api/public/consent${c ? `?c=${encodeURIComponent(c)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: d.notice.id,
          documentVersion: d.notice.version,
          visitorId: visitorId(),
          subjectKind: params.get("kind") || "visitor",
          name: who.name || params.get("name") || undefined,
          email: who.email || params.get("email") || undefined,
          phone: who.phone || params.get("phone") || undefined,
          purposes: picked,
          source: params.get("from") || "website",
          page: params.get("page") || document.referrer || "",
          openedAt: opened.current,
          readSeconds: seconds,
          scrollPct: pct,
          reachedEndAt: endAt,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not record your consent");
      setDone(j);
      const next = params.get("next");
      if (next && /^\//.test(next)) setTimeout(() => (window.location.href = next), 1200);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !d)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] p-6">
        <p className="max-w-md text-center text-ink-500">{err}</p>
      </main>
    );
  if (!d)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] text-hive-700">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );

  if (done)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] p-6">
        <div className="w-full max-w-md rounded-[28px] bg-white p-8 text-center shadow-lift">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-hive-50">
            <Check className="h-7 w-7 text-hive-700" />
          </div>
          <h1 className="mt-4 text-xl font-bold">Thank you</h1>
          <p className="mt-2 text-sm text-ink-500">
            Your consent was recorded on {new Date(done.acceptedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. You may withdraw it at any time by writing to {d.company.shortName || d.company.name}.
          </p>
          <p className="mono mt-4 text-[11px] text-ink-400">Reference {done.id}</p>
        </div>
      </main>
    );

  return (
    <main className="flex min-h-screen flex-col bg-[#f7f8f6]">
      <header className="flex items-center gap-3 border-b border-ink-400/15 bg-white px-5 py-3">
        {d.company.logoUrl ? (
          <img src={d.company.logoUrl} alt="" className="h-9 w-9 rounded-full object-contain" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-hive-700 text-sm font-bold text-white">{(d.company.shortName || d.company.name || "C").slice(0, 2).toUpperCase()}</span>
        )}
        <div className="min-w-0">
          <p className="truncate font-bold">{d.company.shortName || d.company.name}</p>
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-hive-700" /> Consent under the Digital Personal Data Protection Act, 2023
          </p>
        </div>
        {d.notice.hasFile && (
          <a href={`/api/public/consent/file${params.get("c") ? `?c=${params.get("c")}` : ""}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-ink-400/20 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-hive-50">
            <FileDown className="h-3.5 w-3.5" /> Original file
          </a>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-[28px] bg-white shadow-lift">
          <div className="flex items-baseline justify-between gap-3 border-b border-ink-400/15 px-5 py-4 sm:px-7">
            <h1 className="text-lg font-bold sm:text-xl">{d.notice.title}</h1>
            <span className="whitespace-nowrap text-xs text-ink-400">v{d.notice.version}</span>
          </div>

          {/* The notice. Accept stays off until this has been scrolled to the end. */}
          <div ref={box} onScroll={onScroll} className="kb-doc max-h-[52vh] overflow-y-auto px-5 py-5 sm:px-7" dangerouslySetInnerHTML={{ __html: d.notice.html }} />

          <div className="border-t border-ink-400/15 px-5 py-3 sm:px-7">
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-400/15">
                <div className="h-full rounded-full bg-hive-700 transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <span className="whitespace-nowrap text-xs font-semibold text-ink-500">{read ? "Read" : `${pct}% read`}</span>
            </div>
            {!read && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-500">
                <ArrowDown className="h-3.5 w-3.5" /> Please scroll to the end of the notice to continue.
              </p>
            )}
          </div>
        </div>

        <section className="rounded-[28px] bg-white p-5 shadow-lift sm:p-7">
          <h2 className="font-bold">What you are agreeing to</h2>
          <p className="mt-1 text-sm text-ink-500">The first three are needed to answer you and to keep the records the law requires. The others are yours to choose.</p>
          <ul className="mt-4 space-y-3">
            {d.purposes.map((p: Purpose) => (
              <li key={p.key}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-hive-700 disabled:opacity-60"
                    checked={picked.includes(p.key)}
                    disabled={p.required}
                    onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.key] : x.filter((k) => k !== p.key)))}
                  />
                  <span className="text-sm">
                    <b>{p.label}</b>
                    {p.required && <span className="ml-2 rounded-full bg-ink-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-500">needed</span>}
                    <span className="block text-ink-500">{p.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <input className="input" placeholder="Your name" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} />
            <input className="input" type="email" placeholder="E-mail" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} />
            <input className="input" inputMode="numeric" placeholder="Phone" value={who.phone} onChange={(e) => setWho({ ...who, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
          </div>
          <p className="mt-2 text-xs text-ink-400">Giving your name and a way to reach you lets {d.company.shortName || d.company.name} find this consent later if you ask to withdraw it.</p>

          {err && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</p>}

          <button
            type="button"
            disabled={!canAccept}
            onClick={accept}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-hive-700 px-5 py-3.5 text-base font-bold text-white shadow-lg transition hover:bg-hive-900 disabled:cursor-not-allowed disabled:bg-ink-400/30 disabled:text-ink-500 disabled:shadow-none"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            {read ? "I have read and accept" : "Read the notice to continue"}
          </button>
          <p className="mt-3 text-center text-xs text-ink-400">Your choice, the time you spent on this notice and the version you read are recorded as evidence of consent.</p>
        </section>
      </div>
    </main>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Send, Lock, Sparkles, Settings2 } from "lucide-react";
import { api } from "@/lib/api";
import { Spinner } from "./ui";

type Msg = { role: "user" | "assistant"; content: string };

/** Tiny, safe markdown: **bold**, bullet lines, line breaks. No HTML injection. */
function Md({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {text.split(/\n+/).map((line, i) => {
        const bullet = /^\s*[-•*]\s+/.test(line);
        const parts = line.replace(/^\s*[-•*]\s+/, "").split(/(\*\*[^*]+\*\*)/g);
        const body = parts.map((p, j) => (p.startsWith("**") && p.endsWith("**") ? <b key={j}>{p.slice(2, -2)}</b> : <span key={j}>{p}</span>));
        return bullet ? (
          <p key={i} className="flex gap-2">
            <span className="text-hive-600">•</span>
            <span>{body}</span>
          </p>
        ) : (
          <p key={i}>{body}</p>
        );
      })}
    </div>
  );
}

const STARTERS = ["How many new leads came in today?", "Which source converted best this month?", "Show follow-ups due tomorrow", "Summarise lost reasons this quarter"];

/** Floating assistant (company console). Always visible; shows a set-up card until an assistant agent with an AI model exists. */
export function Assistant({ companyName }: { companyName?: string }) {
  const [info, setInfo] = useState<{ enabled: boolean; ready?: boolean; name?: string; logoUrl?: string; canSetup?: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api("/co/assistant").then(setInfo).catch(() => setInfo({ enabled: false }));
  }, []);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs.length, busy]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  if (!info) return null;
  const live = info.enabled && info.ready;

  async function send(text: string) {
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api("/co/assistant/chat", { body: { messages: next } });
      setMsgs([...next, { role: "assistant", content: r.text }]);
      setUsage(r.usage);
    } catch (e: any) {
      setMsgs([...next, { role: "assistant", content: `⚠️ ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const Logo = ({ size }: { size: string }) =>
    info.logoUrl ? (
      <img src={info.logoUrl} alt="" className={`${size} rounded-full bg-white object-contain p-0.5`} />
    ) : (
      <span className={`${size} grid place-items-center rounded-full bg-white text-hive-700`}>
        <Sparkles className="h-1/2 w-1/2" />
      </span>
    );

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={`Open ${info.name}`}
          className="group fixed bottom-5 right-5 z-40 grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-hive-600 to-hive-900 shadow-glow ring-4 ring-white transition hover:scale-105 sm:bottom-7 sm:right-7"
        >
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-hive-500/25 [animation-duration:2.8s]" />
          <Logo size="h-12 w-12" />
        </button>
      )}
      {open && (
        <section role="dialog" aria-label={info.name} className="fixed inset-x-3 bottom-3 z-50 flex h-[min(640px,calc(100dvh-24px))] flex-col overflow-hidden rounded-[26px] bg-white shadow-2xl ring-1 ring-black/5 sm:inset-x-auto sm:bottom-7 sm:right-7 sm:w-[420px]">
          <header className="flex items-center gap-3 bg-gradient-to-br from-hive-800 to-hive-950 px-4 py-3.5 text-white">
            <Logo size="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{info.name}</p>
              <p className="flex items-center gap-1 text-[11.5px] text-white/65">
                <Lock className="h-3 w-3" /> Read-only access to {companyName || "your"} data
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close assistant">
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto bg-[#f7f8f6] p-4" aria-live="polite">
            {!live && (
              <div className="rounded-2xl bg-white p-4 text-sm text-ink-700 shadow-card">
                <p className="font-semibold text-ink-900">Your assistant isn’t switched on yet</p>
                <p className="mt-1.5">
                  {!info.enabled
                    ? "Create an AI Agent, add your knowledge files and tick “Use as floating assistant”."
                    : "The assistant agent exists but has no AI model yet. Your Super Admin allocates a model with credits; then pick it on the agent."}
                </p>
                {info.canSetup && (
                  <Link href="/app/settings/ai-agents" onClick={() => setOpen(false)} className="btn-primary mt-3 inline-flex">
                    <Settings2 className="h-4 w-4" /> Set up in Settings › AI Agent
                  </Link>
                )}
              </div>
            )}
            {live && !msgs.length && (
              <div className="space-y-2 pt-2">
                <p className="text-sm text-ink-500">Ask about your leads, follow-ups, sources or WhatsApp delivery.</p>
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="block w-full rounded-xl border border-ink-400/15 bg-white px-3 py-2.5 text-left text-sm font-medium text-ink-900 shadow-card hover:border-hive-300 hover:bg-hive-50">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${m.role === "user" ? "ml-auto bg-hive-700 text-white" : "bg-white text-ink-900 shadow-card"}`}>
                {m.role === "assistant" ? <Md text={m.content} /> : m.content}
              </div>
            ))}
            {busy && (
              <div className="flex w-fit items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-sm text-ink-500 shadow-card">
                <Spinner /> Looking it up…
              </div>
            )}
            <div ref={end} />
          </div>
          {live && (
          <form
            className="flex items-end gap-2 border-t border-ink-400/10 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim() && !busy) send(input.trim());
            }}
          >
            <textarea
              className="input max-h-28 min-h-[44px] resize-none"
              rows={1}
              value={input}
              placeholder="Ask anything about your data…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !busy) send(input.trim());
                }
              }}
            />
            <button type="submit" disabled={!input.trim() || busy} className="btn-primary h-11 w-11 shrink-0 p-0" aria-label="Send">
              <Send className="h-4 w-4" />
            </button>
          </form>
          )}
          {usage && <p className="px-4 pb-2 text-[11px] text-ink-400">{usage.remaining.toLocaleString("en-IN")} AI credits left</p>}
        </section>
      )}
    </>
  );
}

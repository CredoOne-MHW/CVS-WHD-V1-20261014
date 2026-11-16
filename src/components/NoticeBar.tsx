"use client";
/**
 * The scrolling notice an administrator puts across the top of every screen.
 *
 * It appears the moment it is posted — no reload — and a person can close one; closing it is remembered on
 * that device only, so the next notice still shows. Nothing scrolls when there is nothing to say, and the
 * animation stops for anyone who has asked their system for less motion.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { subscribe, poller, realtimeConfig, notices } from "@/lib/realtime";
import { EVENTS } from "@shared/chat";

const TONE: Record<string, string> = {
  info: "bg-hive-800 text-white",
  warning: "bg-honey-500 text-ink-900",
  success: "bg-emerald-600 text-white",
};
const KEY = "lms_notice_hidden";

const hidden = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};

export default function NoticeBar({ companyId }: { companyId?: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [scrolls, setScrolls] = useState(false); // only a notice too long for the bar moves
  const track = useRef<HTMLSpanElement | null>(null);

  const load = useCallback(async (fresh = false) => {
    setItems(await notices(fresh));
  }, []);

  useEffect(() => {
    setDismissed(hidden());
    load();
  }, [load]);

  useEffect(() => {
    if (!companyId) return;
    let stop = () => {};
    subscribe(realtimeConfig(), `private-co-${companyId}-all`, { [EVENTS.notice]: () => load(true) }).then((f) => (stop = f));
    const off = poller(() => load(true), 60000);
    return () => {
      stop();
      off();
    };
  }, [companyId, load]);

  const close = (id: string) => {
    const next = Array.from(new Set([...dismissed, id])).slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* a device that keeps nothing simply shows it again */
    }
  };

  // a short notice stays put and is read at a glance; a long one slides so the end of it can be reached
  const measure = useCallback(() => {
    const el = track.current;
    if (!el?.parentElement) return;
    setScrolls(el.scrollWidth > el.parentElement.clientWidth + 4);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, items, dismissed]);

  const live = items.filter((n) => !dismissed.includes(String(n._id)));
  if (!live.length) return null;
  const n = live[0];
  const text = String(n.text || "");

  return (
    <div className={`relative flex items-center gap-2 overflow-hidden px-3 py-1.5 text-sm font-medium ${TONE[n.tone] || TONE.info}`} role="status" aria-live="polite">
      <Megaphone className="h-4 w-4 shrink-0 opacity-90" />
      <div className="marquee min-w-0 flex-1">
        <span ref={track} className={scrolls ? "marquee-track" : "marquee-still"}>
          {text}
          {live.length > 1 && <span className="opacity-70"> · {live.length - 1} more notice{live.length > 2 ? "s" : ""}</span>}
        </span>
      </div>
      <button onClick={() => close(String(n._id))} aria-label="Hide this notice" className="shrink-0 rounded p-1 opacity-80 hover:bg-black/10 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";

/** True inside the template picker's scaled previews — they show a still image instead of starting WebGL. */
export const PreviewCtx = createContext(false);

const webgl = () => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
};

/** Still poster (previews, no WebGL, while the engine loads): the logo tile with its aura in the brand glow. */
function Poster({ logoUrl, name }: { logoUrl?: string; name: string }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(80% 70% at 50% 38%, rgb(var(--brand-600)) 0%, rgb(var(--brand-800)) 45%, rgb(var(--brand-950)) 100%)" }}>
      <div className="absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-hive-300/25 blur-3xl" />
      <div className="absolute left-1/2 top-[38%] h-[300px] w-[560px] -translate-x-1/2 -translate-y-1/2 rotate-[-8deg] rounded-[50%] border border-white/30" />
      <div className="absolute left-1/2 top-[38%] h-[250px] w-[480px] -translate-x-1/2 -translate-y-1/2 rotate-[14deg] rounded-[50%] border border-honey-300/40" />
      <div className="absolute left-1/2 top-[38%] grid h-[230px] w-[230px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-[0_0_80px_10px_rgb(var(--brand-300)/.45),inset_-18px_-22px_50px_rgb(var(--brand-300)/.55)]" style={{ background: "radial-gradient(circle at 42% 38%, #f6f7fb 0%, #eceef6 55%, rgb(var(--brand-200)) 100%)" }}>
        {logoUrl ? <img src={logoUrl} alt="" className="h-[66%] w-[66%] object-contain" /> : <span className="text-5xl font-extrabold text-hive-700">{name.slice(0, 2).toUpperCase()}</span>}
      </div>
      <span className="absolute left-[27%] top-[50%] h-5 w-5 rounded-full bg-honey-300 shadow-[0_0_20px_rgb(var(--accent-300)/.8)]" />
      <span className="absolute left-[70%] top-[27%] h-7 w-7 rounded-full bg-hive-200" />
    </div>
  );
}

/**
 * Cinematic WebGL scene (Three.js, loaded on demand). Starts only when its panel is actually shown (desktop),
 * falls back to the poster when WebGL is unavailable.
 */
export function CinematicScene({ logoUrl, name, onPhase }: { logoUrl?: string; name: string; onPhase?: (i: number) => void }) {
  const preview = useContext(PreviewCtx);
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const phaseCb = useRef(onPhase);
  phaseCb.current = onPhase;

  useEffect(() => {
    const el = host.current;
    if (preview || !el) return;
    if (!webgl()) {
      setFailed(true);
      return;
    }
    let stop: (() => void) | null = null;
    let cancelled = false;
    // the panel is hidden on phones (display:none) — only start once it has a size
    const boot = () => {
      if (stop || cancelled || !el.clientWidth || !el.clientHeight) return;
      import("./engine")
        .then(({ start }) => {
          if (cancelled || stop) return;
          stop = start(el, { logoUrl, name, onPhase: (i) => phaseCb.current?.(i) });
          setReady(true);
        })
        .catch(() => setFailed(true));
    };
    const ro = new ResizeObserver(boot);
    ro.observe(el);
    boot();
    return () => {
      cancelled = true;
      ro.disconnect();
      stop?.();
    };
  }, [preview, logoUrl, name]);

  return (
    <div ref={host} className="absolute inset-0">
      {(preview || failed || !ready) && <Poster logoUrl={logoUrl} name={name} />}
    </div>
  );
}

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

/** deterministic neuron dots for the poster (a brain-shaped cloud, two lobes) */
const DOTS = (() => {
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: { x: number; y: number; s: number; o: number }[] = [];
  while (out.length < 170) {
    const x = r() * 2 - 1, y = r() * 2 - 1;
    const lobe = Math.min(((x - 0.36) / 0.62) ** 2 + (y / 0.78) ** 2, ((x + 0.36) / 0.62) ** 2 + (y / 0.78) ** 2);
    if (lobe > 1 || lobe < 0.55 || Math.hypot(x, y) < 0.42) continue;
    out.push({ x, y, s: r() < 0.08 ? 5 : 2 + r() * 2, o: 0.35 + r() * 0.6 });
  }
  return out;
})();

/** Still poster (previews, no WebGL, while the engine loads): the neural brain with the logo disc at its core. */
function Poster({ logoUrl, name }: { logoUrl?: string; name: string }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(75% 65% at 50% 36%, rgb(var(--brand-700)) 0%, rgb(var(--brand-900)) 50%, rgb(var(--brand-950)) 100%)" }}>
      <div className="absolute left-1/2 top-[36%] h-[460px] w-[600px] -translate-x-1/2 -translate-y-1/2">
        {DOTS.map((d, i) => (
          <span key={i} className="absolute rounded-full bg-hive-200" style={{ left: `${50 + d.x * 50}%`, top: `${50 + d.y * 50}%`, width: d.s, height: d.s, opacity: d.o, boxShadow: d.s > 4 ? "0 0 10px rgb(var(--brand-200))" : undefined }} />
        ))}
      </div>
      <div className="absolute left-1/2 top-[36%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-hive-300/25 blur-3xl" />
      <div className="absolute left-1/2 top-[36%] h-[176px] w-[176px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40" />
      <div className="absolute left-1/2 top-[36%] h-[200px] w-[200px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-honey-300/40" />
      <div className="absolute left-1/2 top-[36%] grid h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-[0_0_60px_8px_rgb(var(--brand-300)/.5)]">
        {logoUrl ? <img src={logoUrl} alt="" className="h-[68%] w-[68%] object-contain" /> : <span className="text-5xl font-extrabold text-hive-700">{name.slice(0, 2).toUpperCase()}</span>}
      </div>
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

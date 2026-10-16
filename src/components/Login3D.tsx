"use client";
/**
 * 3D scenes for the login pages — pure CSS 3D (perspective + preserve-3d), GPU-composited transforms only,
 * no libraries. Theme: leads arriving from every source → clients managed end to end → AI intelligence.
 * Respects prefers-reduced-motion; previews (.lp-preview) are rendered still.
 */
import { useRef, type ReactNode, type PointerEvent } from "react";
import { Globe, MessageCircle, Megaphone, Search, Mail, PhoneCall, QrCode, Handshake, Store, ShoppingBag, FileSpreadsheet, Braces, Sparkles, Users, Briefcase, CheckCircle2, BrainCircuit, TrendingUp, Zap } from "lucide-react";

const SOURCES = [
  { Icon: Globe, label: "Website" },
  { Icon: MessageCircle, label: "WhatsApp" },
  { Icon: Megaphone, label: "Meta Ads" },
  { Icon: Search, label: "Google Ads" },
  { Icon: Store, label: "IndiaMART" },
  { Icon: Mail, label: "Email" },
  { Icon: PhoneCall, label: "Calls" },
  { Icon: ShoppingBag, label: "Shopify" },
  { Icon: QrCode, label: "QR Codes" },
  { Icon: Handshake, label: "Partners" },
  { Icon: FileSpreadsheet, label: "Excel" },
  { Icon: Braces, label: "REST API" },
];

/* ───────────── pointer parallax (sets --rx / --ry on the element, rAF-throttled) ───────────── */
export function useTilt(max = 7) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${(-y * max).toFixed(2)}deg`);
    });
  };
  const onPointerLeave = () => {
    ref.current?.style.setProperty("--ry", "0deg");
    ref.current?.style.setProperty("--rx", "0deg");
  };
  return { ref, onPointerMove, onPointerLeave };
}

const initials = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "•";

/**
 * The logo in a glowing disc with an aura of light orbiting it.
 * The logo is never clipped: it is scaled to fit inside the disc (wide logos included), no rounding on the image.
 */
export function AuraLogo({ src, name, size = 300 }: { src?: string; name: string; size?: number }) {
  return (
    <div className="l3-aura relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <span aria-hidden className="absolute inset-0 rounded-full border border-white/20" />
      <span aria-hidden className="aura-glow" />
      <span aria-hidden className="aura-comet" />
      <span aria-hidden className="aura-trail" />
      <span aria-hidden className="l3-aura-dot" />
      <span aria-hidden className="aura-breathe absolute inset-[13%] rounded-full shadow-[0_20px_60px_-10px_rgba(0,0,0,.45),inset_0_-12px_30px_rgb(var(--brand-200)/.55)]" style={{ background: "radial-gradient(circle at 50% 38%, #ffffff 0%, #ffffff 46%, rgb(var(--brand-50)) 66%, rgb(var(--brand-200)) 100%)" }} />
      {/* logo area = the disc's inscribed square with breathing room → any aspect ratio fits uncropped */}
      <span className="relative grid place-items-center" style={{ width: size * 0.56, height: size * 0.56 }}>
        {src ? <img src={src} alt={name} className="max-h-full max-w-full object-contain drop-shadow-[0_4px_10px_rgba(20,20,60,.18)]" draggable={false} /> : <span className="font-extrabold text-hive-800" style={{ fontSize: size * 0.2 }}>{initials(name)}</span>}
      </span>
    </div>
  );
}

/* ───────────── Orbit: logo + tilted 3D ring of lead sources + inner AI ring ───────────── */
export function OrbitScene({ src, name, size = 420 }: { src?: string; name: string; size?: number }) {
  const R = size * 0.66;
  const ring = SOURCES.slice(0, 10);
  return (
    <div className="l3-stage relative" style={{ width: size * 1.55, height: size * 1.08, perspective: 1300 }}>
      <div className="l3-scene absolute inset-0 grid place-items-center">
        {/* outer ring: lead sources orbiting */}
        <div className="l3-ring absolute" style={{ width: R * 2, height: R * 2 }}>
          <div className="l3-spin absolute inset-0">
            <span aria-hidden className="absolute inset-0 rounded-full border border-white/25 shadow-[0_0_40px_rgb(var(--brand-300)/.35)]" />
            <span aria-hidden className="absolute inset-[6%] rounded-full border border-dashed border-white/15" />
            {ring.map(({ Icon, label }, i) => {
              const a = (360 / ring.length) * i;
              return (
                <div key={label} className="l3-item absolute left-1/2 top-1/2" style={{ ["--a" as any]: `${a}deg`, transform: `rotateZ(${a}deg) translateX(${R}px)` }}>
                  <div className="l3-face -ml-[40px] -mt-[22px] flex w-20 flex-col items-center">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-b from-white/25 to-white/5 shadow-[0_10px_24px_-8px_rgba(0,0,0,.6),inset_0_1px_0_rgba(255,255,255,.35)] ring-1 ring-white/25">
                      <Icon className="h-5 w-5 text-white" strokeWidth={1.8} aria-hidden />
                    </span>
                    <span className="mt-1 whitespace-nowrap text-[10.5px] font-semibold text-white/75">{label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* inner ring: AI pulses */}
        <div className="l3-ring l3-ring-inner absolute" style={{ width: R * 1.18, height: R * 1.18 }}>
          <div className="l3-spin l3-spin-rev absolute inset-0">
            <span aria-hidden className="absolute inset-0 rounded-full border border-honey-300/40" />
            {[0, 120, 240].map((a) => (
              <span key={a} aria-hidden className="absolute left-1/2 top-1/2 -ml-1.5 -mt-1.5 h-3 w-3 rounded-full bg-honey-300 shadow-[0_0_16px_4px_rgb(var(--accent-300)/.7)]" style={{ transform: `rotateZ(${a}deg) translateX(${R * 0.59}px)` }} />
            ))}
          </div>
        </div>
        {/* the logo sits in the same 3D space, so sources pass behind and in front of it */}
        <div className="l3-center relative">
          <AuraLogo src={src} name={name} size={size * 0.64} />
        </div>
      </div>
    </div>
  );
}

/* ───────────── three floating glass cards: sources → clients → AI ───────────── */
function Glass({ children, className = "", style }: { children: ReactNode; className?: string; style?: any }) {
  return (
    <div className={`l3-card rounded-[20px] border border-white/15 bg-white/[.08] p-4 text-left text-white shadow-[0_30px_60px_-20px_rgba(0,0,0,.6),inset_0_1px_0_rgba(255,255,255,.18)] backdrop-blur-md ${className}`} style={style}>
      <span aria-hidden className="l3-sheen pointer-events-none absolute inset-0 rounded-[20px]" />
      {children}
    </div>
  );
}
export function PillarCards({ compact = false }: { compact?: boolean }) {
  return (
    <div className="l3-cards grid w-full max-w-[640px] grid-cols-3 gap-4" style={{ perspective: 1100 }}>
      <Glass className="relative" style={{ ["--ry0" as any]: "16deg", ["--d" as any]: "0s" }}>
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-white/60">
          <Zap className="h-3.5 w-3.5 text-honey-300" /> Leads in
        </p>
        <p className="mt-1.5 text-[14px] font-bold leading-snug">From every source</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SOURCES.slice(0, compact ? 4 : 6).map(({ Icon, label }, i) => (
            <span key={label} className="l3-ping grid h-7 w-7 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15" style={{ animationDelay: `${i * 0.35}s` }} title={label}>
              <Icon className="h-3.5 w-3.5" />
            </span>
          ))}
        </div>
      </Glass>
      <Glass className="relative" style={{ ["--ry0" as any]: "0deg", ["--tz" as any]: "40px", ["--d" as any]: "-2s" }}>
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-white/60">
          <Briefcase className="h-3.5 w-3.5 text-honey-300" /> Clients
        </p>
        <p className="mt-1.5 text-[14px] font-bold leading-snug">Managed end to end</p>
        <div className="relative mt-4 flex items-center justify-between">
          <span aria-hidden className="absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 rounded bg-white/15" />
          <span aria-hidden className="l3-travel absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-honey-300 shadow-[0_0_12px_3px_rgb(var(--accent-300)/.7)]" />
          {[Users, Briefcase, CheckCircle2].map((I, i) => (
            <span key={i} className="relative grid h-7 w-7 place-items-center rounded-full bg-hive-700 ring-2 ring-white/30">
              <I className="h-3.5 w-3.5" />
            </span>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-white/55">
          <span>Lead</span>
          <span>Service</span>
          <span>Paid</span>
        </div>
      </Glass>
      <Glass className="relative" style={{ ["--ry0" as any]: "-16deg", ["--d" as any]: "-4s" }}>
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-white/60">
          <BrainCircuit className="h-3.5 w-3.5 text-honey-300" /> AI
        </p>
        <p className="mt-1.5 text-[14px] font-bold leading-snug">Intelligence built in</p>
        <div className="mt-3 flex items-center gap-2.5">
          <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="4" />
            <circle className="l3-dial" cx="18" cy="18" r="15" fill="none" stroke="rgb(var(--accent-300))" strokeWidth="4" strokeLinecap="round" strokeDasharray="94.2" strokeDashoffset="14" />
          </svg>
          <svg viewBox="0 0 60 24" className="h-7 flex-1" aria-hidden>
            <polyline className="l3-spark" points="0,20 10,16 20,18 30,10 40,12 50,5 60,7" fill="none" stroke="white" strokeOpacity=".85" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>
        <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-white/60">
          <Sparkles className="h-3 w-3 text-honey-300" /> Scores · insights · next step
        </p>
      </Glass>
    </div>
  );
}

/* ───────────── isometric stack: three layers lifting off (Sources · Clients · AI) ───────────── */
export function LayerStack() {
  const layers = [
    { t: "AI intelligence", d: "Scores every lead, answers questions on your data", Icon: BrainCircuit, tone: "from-honey-300/90 to-honey-500/70 text-hive-950" },
    { t: "Client journey", d: "Board · tickets · subscriptions · payments", Icon: Briefcase, tone: "from-white/30 to-white/10 text-white" },
    { t: "Leads from every source", d: "Website, WhatsApp, ads, marketplaces, shops", Icon: TrendingUp, tone: "from-hive-400/60 to-hive-700/60 text-white" },
  ];
  return (
    <div className="l3-iso-stage relative h-[380px] w-[460px]" style={{ perspective: 1400 }}>
      <div className="l3-iso absolute inset-0">
        {layers.map(({ t, d, Icon, tone }, i) => (
          <div key={t} className={`l3-layer absolute left-1/2 top-1/2 -ml-[150px] -mt-[100px] h-[200px] w-[300px] rounded-[26px] bg-gradient-to-br ${tone} p-5 shadow-[0_40px_80px_-30px_rgba(0,0,0,.7),inset_0_1px_0_rgba(255,255,255,.35)] ring-1 ring-white/25`} style={{ ["--z" as any]: `${(2 - i) * 70}px`, ["--d" as any]: `${-i * 1.6}s` }}>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-black/15 ring-1 ring-white/20">
              <Icon className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[18px] font-extrabold leading-tight">{t}</p>
            <p className="mt-1 text-[12px] leading-snug opacity-75">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── funnel: sources fly in along a 3D floor into the logo portal ───────────── */
export function FunnelScene({ src, name }: { src?: string; name: string }) {
  const lanes = SOURCES.slice(0, 8);
  return (
    <div className="relative h-[420px] w-full max-w-[620px]" style={{ perspective: 700, perspectiveOrigin: "50% 30%" }}>
      <div aria-hidden className="l3-floor absolute -left-1/4 bottom-0 h-[160%] w-[150%]" />
      {lanes.map(({ Icon, label }, i) => (
        <div key={label} className="l3-fly absolute bottom-[18%] left-1/2" style={{ ["--x" as any]: `${(i - (lanes.length - 1) / 2) * 70}px`, ["--d" as any]: `${-i * 0.9}s` }}>
          <span className="flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white ring-1 ring-white/25 backdrop-blur-sm">
            <Icon className="h-3.5 w-3.5" /> {label}
          </span>
        </div>
      ))}
      <div className="absolute left-1/2 top-[4%] z-10 -translate-x-1/2">
        <AuraLogo src={src} name={name} size={220} />
      </div>
    </div>
  );
}

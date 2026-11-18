/**
 * One place for the colours, spacing and type the screens use. The brand colours come from the build.
 *
 * The scale below is deliberately small. A phone screen that mixes six paddings and five corner radii reads
 * as assembled rather than designed, however good each screen is on its own — so there are four spacing
 * steps, three radii and five type sizes, and a screen that wants something else usually wants one of these.
 */
import { BRAND } from "./lib/api";

export const T = {
  brand: BRAND.primary,
  accent: BRAND.accent,
  bg: "#f6f7f5",
  card: "#ffffff",
  text: "#14201a",
  muted: "#6b7a70",
  /** A hairline. Heavier than this and a list of cards starts to look like a spreadsheet. */
  line: "rgba(20,32,26,0.10)",
  /** The tint used for a selected row or a brand-coloured chip background. */
  tint: "rgba(47,92,36,0.08)",
  danger: "#b42318",
  warn: "#fdecec",
  warnText: "#a11",

  radius: 14,
  radiusSm: 10,
  radiusPill: 999,

  /** Spacing: xs 6, sm 10, md 14, lg 18. `pad` is the screen gutter. */
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  pad: 14,
} as const;

/**
 * A brand colour at a given opacity.
 *
 * `T.tint` and several screens hardcode `rgba(47,92,36,…)`, which is the *default* brand green. A company
 * whose build sets another colour therefore gets green selections next to its own headers. This derives the
 * tint from whatever `T.brand` actually is, so the two always agree.
 *
 * Anything that is not a #rgb or #rrggbb value is returned untouched rather than mangled.
 */
export const withAlpha = (hex: string, a: number) => {
  const h = String(hex || "").trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (!m) return h;
  const full = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** The type scale. Weight and size together, so a heading is one choice rather than two. */
export const TYPE = {
  display: { fontSize: 26, fontWeight: "800" as const, color: T.text, letterSpacing: -0.4 },
  title: { fontSize: 16, fontWeight: "800" as const, color: T.text },
  body: { fontSize: 14, fontWeight: "500" as const, color: T.text },
  label: { fontSize: 12.5, fontWeight: "800" as const, color: T.text },
  meta: { fontSize: 11, fontWeight: "500" as const, color: T.muted },
};

/**
 * One soft shadow, used by cards that need to lift off the background.
 *
 * iOS and Android describe elevation differently, so both are set here and neither screen has to remember.
 */
export const LIFT = {
  shadowColor: "#0b140f",
  shadowOpacity: 0.05,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

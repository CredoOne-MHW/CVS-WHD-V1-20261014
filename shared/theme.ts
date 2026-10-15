/**
 * Per-company theming. One hex → a full 50–900 scale, exposed as CSS variables
 * (`--brand-500: 79 147 57`) that Tailwind's `hive-*` and `honey-*` colors read.
 * Light picks are darkened automatically so white text on brand buttons stays ≥ 4.5:1.
 */
type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrastWithWhite = (c: RGB) => 1.05 / (lum(c) + 0.05);
const W: RGB = [255, 255, 255];
const K: RGB = [0, 0, 0];

/** Brand scale: the chosen color is the 700 step (buttons, active nav). */
export function brandScale(hex: string): Record<string, RGB> {
  let base = hexToRgb(hex);
  for (let i = 0; i < 12 && contrastWithWhite(base) < 4.6; i++) base = mix(base, K, 0.1);
  return {
    "50": mix(base, W, 0.95),
    "100": mix(base, W, 0.88),
    "200": mix(base, W, 0.74),
    "300": mix(base, W, 0.56),
    "400": mix(base, W, 0.36),
    "500": mix(base, W, 0.18),
    "600": mix(base, W, 0.08),
    "700": base,
    "800": mix(base, K, 0.2),
    "900": mix(base, K, 0.4),
    "950": mix(base, K, 0.58),
  };
}

export function accentScale(hex: string): Record<string, RGB> {
  const base = hexToRgb(hex);
  return { "100": mix(base, W, 0.84), "300": mix(base, W, 0.4), "500": base, "700": mix(base, K, 0.42) };
}

export function themeVars(primary: string, accent: string): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, c] of Object.entries(brandScale(primary))) v[`--brand-${k}`] = c.join(" ");
  for (const [k, c] of Object.entries(accentScale(accent))) v[`--accent-${k}`] = c.join(" ");
  return v;
}

/** Browser only: apply to <html>. */
export function applyTheme(primary?: string, accent?: string) {
  if (typeof document === "undefined" || !primary) return;
  const vars = themeVars(primary, accent || primary);
  for (const [k, val] of Object.entries(vars)) document.documentElement.style.setProperty(k, val);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", primary);
}

/** Rounded-square monogram (e.g. "WD") in the brand colour — used as favicon / avatar when no logo is uploaded. */
export function initialsIcon(name = "", color = "#2f5c24") {
  const ini =
    name
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "•";
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : "#2f5c24";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${c}"/><text x="32" y="33" dominant-baseline="central" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${ini.length > 1 ? 26 : 32}" font-weight="700" fill="#fff">${ini}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Sets the browser-tab icon; falls back to a brand-coloured monogram so the tab never shows the generic globe. */
export function setFavicon(url?: string, fallback?: { name?: string; color?: string }) {
  if (typeof document === "undefined") return;
  const href = url || (fallback ? initialsIcon(fallback.name, fallback.color) : "");
  if (!href) return;
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach((l) => l.remove());
  for (const rel of ["icon", "apple-touch-icon"]) {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    document.head.appendChild(link);
  }
}

export const THEME_PRESETS = ["#2f5c24", "#2b2d72", "#0f4c81", "#7a1f3d", "#0e6b62", "#8a4b08", "#3b3355", "#1f2937"];

import type { Config } from "tailwindcss";

// Brand colors come from CSS variables so each company's theme color re-skins the whole app.
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;
const scale = (prefix: string, steps: string[]) => Object.fromEntries(steps.map((s) => [s, v(`--${prefix}-${s}`)]));

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // classes built dynamically (`btn-${variant}`) must never be purged
  safelist: ["btn", "btn-primary", "btn-secondary", "btn-ghost", "btn-danger"],
  theme: {
    extend: {
      colors: {
        hive: scale("brand", ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]),
        honey: scale("accent", ["100", "300", "500", "700"]),
        ink: { 400: "#7a8577", 500: "#5b6658", 700: "#2f3a2d", 900: "#172015" },
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)",
        lift: "0 12px 32px -12px rgba(16,24,40,.18)",
        glow: "0 10px 30px -10px rgb(var(--brand-700) / .55)",
      },
    },
  },
  plugins: [],
};
export default config;

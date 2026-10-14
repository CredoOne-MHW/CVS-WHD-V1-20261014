import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        hive: {
          50: "#f2f8ef",
          100: "#e1f0d9",
          200: "#c3e0b4",
          300: "#9bc985",
          400: "#73b05a",
          500: "#4f9339",
          600: "#3c752b",
          700: "#2f5c24",
          800: "#284a20",
          900: "#1f3a1a",
        },
        honey: { 100: "#fbf3cf", 300: "#f0d75d", 500: "#d9b52a", 700: "#9b7d14" },
        ink: { 400: "#7a8577", 500: "#5b6658", 700: "#2f3a2d", 900: "#172015" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: { card: "0 1px 2px rgba(23,32,21,.06), 0 4px 16px rgba(23,32,21,.05)" },
    },
  },
  plugins: [],
};
export default config;

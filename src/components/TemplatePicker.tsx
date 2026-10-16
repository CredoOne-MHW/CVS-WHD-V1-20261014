"use client";
import { Check } from "lucide-react";
import { LOGIN_TEMPLATES, TemplateThumb, type LoginBrand, type LoginTemplateKey } from "./LoginTemplates";

/** Grid of the 10 login designs, each a real scaled render in the brand's colours. */
export function TemplatePicker({ value, onChange, brand, vars, cols = 2 }: { value: LoginTemplateKey; onChange: (k: LoginTemplateKey) => void; brand: LoginBrand; vars: Record<string, string>; cols?: 2 | 3 }) {
  return (
    <div role="radiogroup" aria-label="Login page design" className={`grid gap-4 ${cols === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}`} style={vars as any}>
      {LOGIN_TEMPLATES.map((t, i) => {
        const on = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(t.key)}
            className={`group overflow-hidden rounded-2xl border bg-white text-left transition ${on ? "border-hive-600 ring-4 ring-hive-100" : "border-ink-400/20 hover:border-hive-300 hover:shadow-lift"}`}
          >
            <div className="relative overflow-hidden border-b border-ink-400/10 bg-[#f6f7f5]">
              <TemplateThumb template={t.key} b={brand} />
              {on && (
                <span className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-hive-700 text-white shadow-lg">
                  <Check className="h-4 w-4" />
                </span>
              )}
            </div>
            <div className="flex items-start gap-2.5 px-3.5 py-3">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${on ? "bg-hive-700 text-white" : "bg-hive-50 text-hive-700"}`}>{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink-900">{t.name}</span>
                <span className="block truncate text-xs text-ink-500">{t.hint}</span>
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type Option = { value: string; label: string; hint?: string };

/**
 * Searchable dropdown — single or multi select. Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
 * Renders only the first 200 matches so lists with thousands of companies stay instant.
 */
export function SearchSelect(props: {
  options: Option[];
  value: string | string[];
  onChange: (v: any) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  allLabel?: string; // multi: show a "Select all" row
}) {
  const { options, value, onChange, multiple, placeholder = "Select…", disabled } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = useMemo(() => new Set(Array.isArray(value) ? value : value ? [value] : []), [value]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? options.filter((o) => o.label.toLowerCase().includes(t) || o.hint?.toLowerCase().includes(t)) : options).slice(0, 200);
  }, [options, q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    if (open) {
      setCursor(0);
      setTimeout(() => input.current?.focus(), 0);
    } else setQ("");
  }, [open]);

  function pick(v: string) {
    if (!multiple) {
      onChange(v);
      setOpen(false);
      return;
    }
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  }
  const allPicked = multiple && matches.length > 0 && matches.every((m) => selected.has(m.value));
  const toggleAll = () => {
    const next = new Set(selected);
    for (const m of matches) allPicked ? next.delete(m.value) : next.add(m.value);
    onChange([...next]);
  };
  const chosen = options.filter((o) => selected.has(o.value));

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="input flex min-h-[44px] w-full flex-wrap items-center gap-1.5 text-left disabled:opacity-60"
      >
        {multiple && chosen.length ? (
          <>
            {chosen.slice(0, 4).map((o) => (
              <span key={o.value} className="inline-flex max-w-[180px] items-center gap-1 rounded-lg bg-hive-100 px-2 py-0.5 text-xs font-semibold text-hive-800">
                <span className="truncate">{o.label}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${o.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    pick(o.value);
                  }}
                  className="rounded hover:bg-hive-200"
                >
                  <X className="h-3 w-3" />
                </span>
              </span>
            ))}
            {chosen.length > 4 && <span className="text-xs font-semibold text-ink-500">+{chosen.length - 4} more</span>}
          </>
        ) : !multiple && chosen[0] ? (
          <span className="truncate">{chosen[0].label}</span>
        ) : (
          <span className="text-ink-400">{placeholder}</span>
        )}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-ink-400" />
      </button>
      {open && (
        <div
          className="absolute z-[60] mt-1.5 w-full overflow-hidden rounded-2xl border border-ink-400/15 bg-white shadow-xl"
          onKeyDown={(e) => {
            // Esc anywhere in the open dropdown closes only the dropdown — never the pop-up it sits in
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            setOpen(false);
          }}
        >
          <div className="flex items-center gap-2 border-b border-ink-400/10 px-3">
            <Search className="h-4 w-4 text-ink-400" />
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, matches.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches[cursor]) pick(matches[cursor].value);
                }
              }}
              placeholder="Search…"
              className="h-10 w-full bg-transparent text-sm outline-none"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
            />
          </div>
          <ul id={id} role="listbox" aria-multiselectable={!!multiple} className="max-h-64 overflow-y-auto py-1">
            {multiple && matches.length > 1 && (
              <li>
                <button type="button" onClick={toggleAll} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-hive-700 hover:bg-hive-50">
                  {allPicked ? "Clear all shown" : `Select all shown (${matches.length})`}
                </button>
              </li>
            )}
            {matches.map((o, i) => {
              const on = selected.has(o.value);
              return (
                <li key={o.value} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(o.value)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === cursor ? "bg-hive-50" : ""}`}
                  >
                    {multiple && (
                      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? "border-hive-700 bg-hive-700 text-white" : "border-ink-400/40"}`}>{on && <Check className="h-3 w-3" />}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-xs text-ink-400">{o.hint}</span>}
                    {!multiple && on && <Check className="h-4 w-4 text-hive-700" />}
                  </button>
                </li>
              );
            })}
            {!matches.length && <li className="px-3 py-6 text-center text-sm text-ink-400">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

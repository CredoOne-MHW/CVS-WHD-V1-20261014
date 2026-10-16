"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "./ui";

/** Shared, cached service master (one fetch per page load; refreshed after add/delete). */
let cache: { name: string; _id: string }[] | null = null;
let inflight: Promise<any> | null = null;
const listeners = new Set<(v: any[]) => void>();
async function loadServices(force = false) {
  if (cache && !force) return cache;
  if (!inflight || force) inflight = api<any[]>("/co/service-types", { fresh: force }).then((r) => (cache = r)).finally(() => (inflight = null));
  const r = await inflight;
  listeners.forEach((l) => l(r));
  return r;
}
export function useServices() {
  const [list, setList] = useState<{ name: string; _id: string }[]>(cache || []);
  useEffect(() => {
    listeners.add(setList);
    loadServices().then(setList).catch(() => undefined);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

/**
 * Service dropdown with the master list: search, pick one or many, add a new service (“Add …”) or delete one
 * from the master (trash icon). Deleting from the master never changes records that already use the name.
 */
export function ServicePicker({ value, onChange, multiple = true, placeholder = "Select service…", canEdit = true }: { value: string[] | string; onChange: (v: any) => void; multiple?: boolean; placeholder?: string; canEdit?: boolean }) {
  const list = useServices();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const toast = useToast();
  const selected = useMemo(() => (Array.isArray(value) ? value : value ? [value] : []), [value]);
  const t = q.trim().toLowerCase();
  const matches = useMemo(() => (t ? list.filter((s) => s.name.toLowerCase().includes(t)) : list), [list, t]);
  const exact = list.some((s) => s.name.toLowerCase() === t);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
    else setQ("");
  }, [open]);

  const pick = (name: string) => {
    if (!multiple) {
      onChange(name);
      setOpen(false);
      return;
    }
    onChange(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name]);
  };
  async function add() {
    const name = q.trim();
    if (name.length < 2) return;
    setBusy(true);
    try {
      const doc = await api("/co/service-types", { body: { name } });
      await loadServices(true);
      pick(doc.name);
      setQ("");
      toast("ok", `Added “${doc.name}” to the service list`);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(s: { _id: string; name: string }) {
    if (!confirm(`Remove “${s.name}” from the service list? Records that already use it keep the name.`)) return;
    try {
      await api(`/co/service-types/${s._id}`, { method: "DELETE" });
      await loadServices(true);
      if (selected.includes(s.name)) onChange(multiple ? selected.filter((x) => x !== s.name) : "");
      toast("ok", `Removed “${s.name}”`);
    } catch (e: any) {
      toast("err", e.message);
    }
  }

  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="input flex min-h-[44px] w-full flex-wrap items-center gap-1.5 text-left">
        {selected.length ? (
          selected.slice(0, 6).map((v) => (
            <span key={v} className="inline-flex max-w-[200px] items-center gap-1 rounded-lg bg-hive-100 px-2 py-0.5 text-xs font-semibold text-hive-800">
              <span className="truncate">{v}</span>
              {multiple && (
                <X
                  className="h-3 w-3 shrink-0 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    pick(v);
                  }}
                />
              )}
            </span>
          ))
        ) : (
          <span className="text-ink-400">{placeholder}</span>
        )}
        {selected.length > 6 && <span className="text-xs font-semibold text-ink-500">+{selected.length - 6}</span>}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-ink-400" />
      </button>
      {open && (
        <div
          id={id}
          role="listbox"
          className="absolute z-[60] mt-1.5 w-full overflow-hidden rounded-2xl border border-ink-400/15 bg-white shadow-lift"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.nativeEvent.stopImmediatePropagation();
              setOpen(false);
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (matches[0] && (exact || !canEdit)) pick(matches.find((m) => m.name.toLowerCase() === t)?.name || matches[0].name);
              else if (canEdit && t) add();
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-ink-400/10 px-3">
            <Search className="h-4 w-4 text-ink-400" />
            <input ref={input} className="h-11 flex-1 bg-transparent text-sm outline-none" placeholder={canEdit ? "Search or type a new service…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {matches.map((s) => {
              const on = selected.includes(s.name);
              return (
                <li key={s._id} className="group flex items-center">
                  <button type="button" role="option" aria-selected={on} onClick={() => pick(s.name)} className={`flex flex-1 items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-hive-50 ${on ? "font-semibold text-hive-800" : "text-ink-900"}`}>
                    <span className={`grid h-4 w-4 place-items-center rounded ${multiple ? "border" : ""} ${on ? "border-hive-600 bg-hive-600 text-white" : "border-ink-400/40"}`}>{on && <Check className="h-3 w-3" />}</span>
                    {s.name}
                  </button>
                  {canEdit && (
                    <button type="button" aria-label={`Delete ${s.name}`} title="Delete from the service list" onClick={() => remove(s)} className="mr-2 rounded-lg p-1.5 text-ink-400 opacity-60 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
            {!matches.length && !t && <li className="px-3 py-3 text-sm text-ink-500">No services yet{canEdit ? " — type one above to add it" : ""}.</li>}
            {canEdit && t && !exact && (
              <li>
                <button type="button" disabled={busy || t.length < 2} onClick={add} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-hive-700 hover:bg-hive-50 disabled:opacity-50">
                  <Plus className="h-4 w-4" /> Add “{q.trim()}” to the service list
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SearchSelect, type Option } from "../Select";

/** Client options (Client ID · name), fetched once per page and shared by every dropdown. */
let cache: Option[] | null = null;
let inflight: Promise<Option[]> | null = null;
export const refreshClientOptions = () => {
  cache = null;
};
export function useClientOptions() {
  const [opts, setOpts] = useState<Option[]>(cache || []);
  useEffect(() => {
    if (cache) return;
    inflight = inflight || api<Option[]>("/co/clients/options?limit=500").finally(() => (inflight = null));
    inflight.then((o) => setOpts((cache = o))).catch(() => undefined);
  }, []);
  return opts;
}
export function ClientSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const opts = useClientOptions();
  return <SearchSelect options={opts} value={value} onChange={onChange} placeholder="Search Client ID or name…" disabled={disabled} />;
}

export const STAGE_DOT = (color?: string) => ({ background: color || "#64748b" });
export const PAY_STATUS: Record<string, { label: string; cls: string }> = {
  unpaid: { label: "Unpaid", cls: "bg-honey-100 text-honey-700" },
  overdue: { label: "Over-Due", cls: "bg-red-50 text-red-700" },
  paid: { label: "Paid", cls: "bg-hive-100 text-hive-800" },
};
export const TICKET_STYLE: Record<string, string> = {
  Open: "bg-sky-50 text-sky-800",
  "In Progress": "bg-amber-50 text-amber-800",
  "On Hold": "bg-slate-100 text-slate-700",
  Resolved: "bg-emerald-50 text-emerald-800",
  Closed: "bg-slate-100 text-slate-600",
};
export const ago = (d?: string | Date) => {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

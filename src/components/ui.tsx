"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X, CheckCircle2, AlertTriangle, Loader2, ChevronLeft, ChevronRight, Inbox } from "lucide-react";

/* ───────── Toasts ───────── */
type Toast = { id: number; kind: "ok" | "err"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, kind, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2">
        {list.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${t.kind === "ok" ? "bg-hive-800 text-white" : "bg-red-600 text-white"}`}>
            {t.kind === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────── Modal ───────── */
export function Modal({ open, onClose, title, children, footer, size = "lg" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={`flex max-h-[92vh] w-full ${w} flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-black/5 sm:rounded-[28px]`}>
        <div className="flex items-center justify-between border-b border-ink-400/15 px-6 py-4 sm:px-7 sm:py-5">
          <h2 className="text-lg font-bold text-ink-900 sm:text-xl">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-hive-50 hover:text-ink-900" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-7">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-ink-400/15 px-6 py-4 sm:px-7">{footer}</div>}
      </div>
    </div>
  );
}

/* ───────── Form bits ───────── */
export function Field({ label, required, hint, children, className = "" }: { label: string; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function Btn({ loading, children, variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button {...p} disabled={loading || p.disabled} className={`btn-${variant} ${className}`}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

const BADGE: Record<string, string> = {
  green: "bg-hive-100 text-hive-800",
  honey: "bg-honey-100 text-honey-700",
  red: "bg-red-50 text-red-700",
  gray: "bg-ink-400/10 text-ink-700",
  blue: "bg-sky-50 text-sky-700",
  violet: "bg-violet-50 text-violet-700",
};
export function Badge({ color = "gray", children }: { color?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[color]}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[14.5px] text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-2xl bg-hive-50 p-3 text-hive-600">
        <Inbox className="h-6 w-6" />
      </div>
      <p className="font-semibold text-ink-900">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink-500">
      <span>
        {total ? (page - 1) * limit + 1 : 0}–{Math.min(total, page * limit)} of {total.toLocaleString("en-IN")}
      </span>
      <div className="flex items-center gap-1">
        <button className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2 font-medium text-ink-700">
          {page} / {pages}
        </span>
        <button className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant={danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Btn>
        </>
      }
    >
      <div className="text-sm text-ink-700">{body}</div>
    </Modal>
  );
}

export function JsonView({ value }: { value: any }) {
  return <pre className="mono max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-ink-900 p-4 text-hive-100">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

export function Stat({ label, value, hint, tone = "green" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "green" | "honey" | "red" | "gray" }) {
  const dot = { green: "bg-hive-500", honey: "bg-honey-500", red: "bg-red-500", gray: "bg-ink-400" }[tone];
  const glow = { green: "from-hive-100", honey: "from-honey-100", red: "from-red-50", gray: "from-ink-400/10" }[tone];
  return (
    <div className="card relative overflow-hidden p-5">
      <span aria-hidden className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${glow} to-transparent`} />
      <p className="relative flex items-center gap-2 text-[13px] font-semibold text-ink-500">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </p>
      <p className="relative mt-3 text-[32px] font-extrabold leading-none tracking-[-0.02em] text-ink-900 tabular-nums">{value}</p>
      {hint && <p className="relative mt-2 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/** Horizontal bar list — used for funnels, sources, lost reasons. */
export function BarList({ rows, color = "bg-hive-500", empty = "No data yet" }: { rows: { label: string; value: number; sub?: string }[]; color?: string; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-400">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-2 text-[13px]">
            <span className="truncate font-medium text-ink-700">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink-500">
              {r.value.toLocaleString("en-IN")} {r.sub && <span className="text-ink-400">· {r.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-hive-50">
            <div className={`h-2 rounded-full ${color}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Simple column sparkline for daily trends. */
export function Columns({ data }: { data: { _id: string; n: number; won?: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  if (!data.length) return <p className="py-10 text-center text-sm text-ink-400">No leads in this period</p>;
  return (
    <div className="flex h-40 items-end gap-[3px]">
      {data.map((d) => (
        <div key={d._id} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d._id}: ${d.n} leads${d.won != null ? `, ${d.won} converted` : ""}`}>
          <div className="w-full rounded-t-md bg-hive-200 transition group-hover:bg-hive-300" style={{ height: `${(d.n / max) * 100}%` }}>
            {d.won ? <div className="w-full rounded-t-md bg-hive-600" style={{ height: `${(d.won / d.n) * 100}%`, marginTop: "auto" }} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

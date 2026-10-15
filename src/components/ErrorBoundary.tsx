"use client";
import { Component, type ReactNode } from "react";
import { reportClientError, reloadIfStale } from "@/lib/clientErrors";

type Props = { where: string; children: ReactNode; fallback?: (error: Error, reset: () => void) => ReactNode; onReset?: () => void };

/**
 * Keeps one widget's failure from taking down the whole console (e.g. the floating assistant or a chat window),
 * reports the exact error, and offers a reset.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    if (reloadIfStale(error)) return;
    console.error(`[${this.props.where}]`, error);
    reportClientError(error, this.props.where, info?.componentStack || "");
  }
  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
    return <InlineError error={this.state.error} onReset={this.reset} />;
  }
}

export function InlineError({ error, onReset, compact }: { error: Error; onReset: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={`rounded-2xl border border-red-200 bg-red-50 text-sm text-red-800 ${compact ? "p-3" : "p-4"}`}>
      <p className="font-semibold">This part of the screen hit an error</p>
      <p className="mt-1 break-words font-mono text-[12px] text-red-700">{String(error?.message || error).slice(0, 300)}</p>
      <p className="mt-1 text-[12px] text-red-700/80">It has been reported automatically (Settings › Activity Logs).</p>
      <button type="button" onClick={onReset} className="mt-2.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100">
        Reset
      </button>
    </div>
  );
}

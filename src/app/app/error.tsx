"use client";
import { useEffect } from "react";
import { reportClientError, reloadIfStale } from "@/lib/clientErrors";

/** Keeps the console usable if one screen throws: shows the real message, reports it, and offers a retry. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (reloadIfStale(error)) return; // tab was running an older deployment — a reload fixes it
    console.error(error);
    reportClientError(error, "page");
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-3xl bg-white p-8 text-center shadow-card">
      <p className="text-lg font-bold text-ink-900">Something went wrong on this screen</p>
      <p className="mt-2 text-sm text-ink-500">Your data is safe and the error has been reported (Settings › Activity Logs).</p>
      <p className="mx-auto mt-3 max-w-md break-words rounded-xl bg-[#f7f8f6] px-3 py-2 font-mono text-[12px] text-ink-700">{String(error?.message || "Unknown error").slice(0, 300)}</p>
      <div className="mt-5 flex justify-center gap-2">
        <button className="btn-primary" onClick={reset}>
          Try again
        </button>
        <button className="btn-secondary" onClick={() => location.reload()}>
          Reload page
        </button>
      </div>
    </div>
  );
}

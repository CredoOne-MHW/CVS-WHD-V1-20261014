"use client";
import { useEffect } from "react";

/** Keeps the console usable if one screen throws: shows a calm message with a retry instead of a blank page. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-3xl bg-white p-8 text-center shadow-card">
      <p className="text-lg font-bold text-ink-900">Something went wrong on this screen</p>
      <p className="mt-2 text-sm text-ink-500">Your data is safe. Try again — if it keeps happening, share this code with support: {error.digest || "client"}</p>
      <div className="mt-5 flex justify-center gap-2">
        <button className="btn-primary" onClick={reset}>Try again</button>
        <button className="btn-secondary" onClick={() => location.reload()}>Reload page</button>
      </div>
    </div>
  );
}

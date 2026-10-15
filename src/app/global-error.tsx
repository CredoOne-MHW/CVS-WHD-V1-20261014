"use client";
import { useEffect } from "react";
import { reportClientError, reloadIfStale } from "@/lib/clientErrors";

/** Last-resort boundary (errors in layouts / the console shell). Replaces Next's bare "Application error" page. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (reloadIfStale(error)) return;
    console.error(error);
    reportClientError(error, "global");
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, 'Segoe UI', sans-serif", background: "#f6f6f4", color: "#1c2117", display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <div style={{ maxWidth: 480, margin: 16, background: "#fff", borderRadius: 24, padding: 32, textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,.06)" }}>
          <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Something went wrong</p>
          <p style={{ fontSize: 14, color: "#5f6758", marginTop: 8 }}>Your data is safe and the error has been reported.</p>
          <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, background: "#f7f8f6", borderRadius: 12, padding: "8px 12px", wordBreak: "break-word" }}>{String(error?.message || "Unknown error").slice(0, 300)}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
            <button onClick={reset} style={{ background: "#2f5c24", color: "#fff", border: 0, borderRadius: 12, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}>Try again</button>
            <button onClick={() => location.reload()} style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 12, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}>Reload page</button>
          </div>
        </div>
      </body>
    </html>
  );
}

"use client";
/**
 * Client-side error capture.
 * - Reports any screen error to /api/client-error (shows in Activity Logs as "Screen error", and in Vercel logs).
 * - After a new deployment, a tab still running the old build can fail to load code chunks
 *   ("ChunkLoadError") — that is fixed by reloading once, automatically.
 */
const STALE = /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isStaleBuild(err: any) {
  return STALE.test(String(err?.name || "") + " " + String(err?.message || err || ""));
}

/** Reloads once per 30 s for a stale build; returns true if a reload was started. */
export function reloadIfStale(err: any) {
  if (typeof window === "undefined" || !isStaleBuild(err)) return false;
  try {
    const last = Number(sessionStorage.getItem("lms_stale_reload") || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem("lms_stale_reload", String(Date.now()));
  } catch {}
  window.location.reload();
  return true;
}

let sent = 0;
export function reportClientError(err: any, where: string, componentStack?: string) {
  if (typeof window === "undefined" || sent > 10) return;
  sent++;
  const body = JSON.stringify({
    message: String(err?.message || err || "Unknown error"),
    stack: String(err?.stack || ""),
    componentStack: componentStack || "",
    where,
    url: location.pathname,
    build: (window as any).__NEXT_DATA__?.buildId || document.querySelector<HTMLScriptElement>("script[src*='/_next/static/']")?.src.split("/_next/static/")[1]?.split("/")[0] || "",
  });
  fetch("/api/client-error", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

let installed = false;
/** Global listeners for errors that happen outside React rendering (event handlers, promises). */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    if (reloadIfStale(e.error || e.message)) return;
    if (e.error) reportClientError(e.error, "window.onerror");
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (reloadIfStale(e.reason)) return;
    // API errors are already shown to the user as toasts — only report genuine code errors
    if (e.reason && !(e.reason as any).status) reportClientError(e.reason, "unhandledrejection");
  });
}

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
  window.addEventListener("unhandledrejection", async (e) => {
    if (reloadIfStale(e.reason)) return;
    const reason = e.reason as any;

    /**
     * An unhandled rejection is, by definition, one nobody caught — so nobody showed a toast for it.
     *
     * This used to skip anything with a `status` on the grounds that "API errors are already shown as
     * toasts". That is true of a call with a `.catch`, and those never reach here. The ones that do are
     * exactly the calls with no `.catch`: a screen whose data never arrived, which then sits on a spinner
     * with nothing on screen to say why. Saying so is the least this can do.
     */
    if (reason?.status) {
      const { toastFromAnywhere } = await import("@/components/ui");
      const what = reason.status === 403 ? "You do not have permission for that." : reason.status === 404 ? "That was not found." : reason.message || "The platform did not answer.";
      // the server's own message rarely ends in a full stop, and two sentences running together read badly
      const sentence = /[.!?]$/.test(what) ? what : `${what}.`;
      toastFromAnywhere("err", reason.status >= 500 ? `${sentence} Please try again.` : sentence);
      return;
    }
    if (reason) reportClientError(reason, "unhandledrejection");
  });
}

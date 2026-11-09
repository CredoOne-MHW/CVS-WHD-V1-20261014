export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

/* GET de-duplication + 10 s micro-cache: identical requests fired by several components share one
   network call. Any mutation clears the cache so screens never show stale data after a save. */
const inflight = new Map<string, Promise<any>>();
const recent = new Map<string, { at: number; v: any }>();
const MICRO_TTL = 10_000;

/* Slow-changing, read-only endpoints (menu, profile, branding, pickers, registries). They are answered from the
   local cache at once and refreshed in the background, so moving between screens — and a full reload — paints
   immediately instead of waiting for the network. Everything else keeps the 10 s micro-cache above. */
const SWR = [/^\/auth\/me$/, /^\/co\/services/, /^\/co\/leads\/meta/, /^\/(co|sa)\/webhooks\/events/, /^\/co\/clients-lite/, /^\/sa\/companies-lite/, /^\/co\/sso\/providers/, /^\/public\/branding/];
const SWR_TTL = 5 * 60_000;
const swrPath = (p: string) => SWR.some((r) => r.test(p));
const KEY = "credoone.swr.v1";

/** sessionStorage keeps the cache across a reload; it is per tab and cleared on sign-out. */
function persist() {
  if (typeof sessionStorage === "undefined") return;
  try {
    const out: Record<string, { at: number; v: any }> = {};
    for (const [k, e] of recent) if (swrPath(k)) out[k] = e;
    sessionStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* private mode / quota — the memory cache still works */
  }
}
(function hydrate() {
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    for (const [k, e] of Object.entries(JSON.parse(raw) as Record<string, { at: number; v: any }>)) if (Date.now() - e.at < SWR_TTL) recent.set(k, e);
  } catch {
    /* ignore a corrupt cache */
  }
})();
export function clearApiCache() {
  recent.clear();
  try {
    sessionStorage?.removeItem(KEY);
  } catch {}
}

/** Thin fetch wrapper: JSON in/out, cookies included, 401 → login. */
export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData; fresh?: boolean } = {}): Promise<T> {
  const method = opts.method || (opts.body || opts.form ? "POST" : "GET");
  if (method === "GET" && !opts.fresh) {
    const hit = recent.get(path);
    if (hit && Date.now() - hit.at < MICRO_TTL) return hit.v as T;
    // stale-while-revalidate: answer instantly from the cache, refresh in the background for the next read
    if (hit && swrPath(path) && Date.now() - hit.at < SWR_TTL) {
      if (!inflight.has(path)) {
        const bg = request<T>(path, method, opts)
          .then((v) => {
            recent.set(path, { at: Date.now(), v });
            persist();
            return v;
          })
          .catch(() => hit.v as T)
          .finally(() => inflight.delete(path));
        inflight.set(path, bg);
      }
      return hit.v as T;
    }
    const pending = inflight.get(path);
    if (pending) return pending as Promise<T>;
    const p = request<T>(path, method, opts)
      .then((v) => {
        recent.set(path, { at: Date.now(), v });
        if (swrPath(path)) persist();
        return v;
      })
      .finally(() => inflight.delete(path));
    inflight.set(path, p);
    return p;
  }
  if (method !== "GET") clearApiCache(); // a save must never leave a stale screen behind
  return request<T>(path, method, opts);
}

async function request<T>(path: string, method: string, opts: { body?: any; form?: FormData }): Promise<T> {
  const init: RequestInit = { method, credentials: "include", headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    (init.headers as any)["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login")) window.location.href = "/login";
    const details = data?.details;
    const first = details && typeof details === "object" ? Object.entries(details).map(([k, v]: any) => `${k}: ${Array.isArray(v) ? v[0] : v}`)[0] : "";
    throw new ApiError(res.status, [data?.error || res.statusText, first].filter(Boolean).join(" — "), details);
  }
  return data as T;
}

export const qs = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const fmtDate = (d?: string | Date | null, withTime = true) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "—";

export const inr = (n: number) => `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** POST a JSON body and save the response as a file (Excel / CSV exports). */
export async function download(path: string, body: any, fallbackName: string) {
  const res = await fetch(`/api${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.error || res.statusText);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

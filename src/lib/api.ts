export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

/** Thin fetch wrapper: JSON in/out, cookies included, 401 → login. */
export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method || (opts.body || opts.form ? "POST" : "GET"), credentials: "include", headers: {} };
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

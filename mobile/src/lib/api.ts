/**
 * Talking to the company's own platform.
 *
 * The address is baked into the build (`extra.apiBase`), so an app only ever talks to the company it was
 * built for. The session cookie the platform sets is kept by hand, because React Native has no cookie jar
 * that survives a restart.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra || {}) as Record<string, string>;
export const API_BASE = (extra.apiBase || "").replace(/\/$/, "");
export const BRAND = {
  companyName: extra.companyName || "Leads",
  companyCode: extra.companyCode || "",
  primary: extra.primary || "#2f5c24",
  accent: extra.accent || "#d9b52a",
  version: extra.buildVersion || "1.0.0",
  build: extra.buildNumber || "1",
};

const TOKEN_KEY = "lms.session";
let token: string | null = null;

export async function loadSession() {
  token = await AsyncStorage.getItem(TOKEN_KEY);
  return token;
}
/** The session cookie, for the few places that must pass it by hand (the real-time service's auth call). */
export const sessionToken = () => token;

export async function setSession(value: string | null) {
  token = value;
  if (value) await AsyncStorage.setItem(TOKEN_KEY, value);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const method = opts.method || (opts.body ? "POST" : "GET");
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `lms_token=${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // the platform sets the session on sign-in; keep it for the next start
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const m = /lms_token=([^;]+)/.exec(setCookie);
    if (m) await setSession(m[1]);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401) await setSession(null);
    throw new ApiError(res.status, data?.error || res.statusText || "Something went wrong");
  }
  return data as T;
}

export const signIn = (email: string, password: string) => api("/auth/login", { body: { email, password } });
export const signOut = async () => {
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  await setSession(null);
};
export const me = () => api("/auth/me");

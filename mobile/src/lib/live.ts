/**
 * Real-time and push, on the phone.
 *
 * The platform tells the app which real-time service it uses (/co/chat/people answers it), so the app does
 * not need to be rebuilt to change service — or to turn it off: with no service configured, every screen
 * falls back to asking every few seconds and nothing else changes.
 *
 * The session is a cookie kept by hand, so it is passed to the real-time service's auth call by hand too.
 */
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api, API_BASE, BRAND, sessionToken } from "./api";

export type LiveConfig = { provider: "pusher" | "ably" | "none"; key?: string; cluster?: string; authEndpoint?: string; pollMs?: number };

let cfg: LiveConfig = { provider: "none", pollMs: 5000 };
let socket: any = null;
const channels = new Map<string, any>();

export const liveConfig = () => cfg;
export const isLive = () => cfg.provider !== "none";
export const setLiveConfig = (c?: LiveConfig | null) => {
  if (c?.provider) cfg = c;
};

async function connect() {
  if (cfg.provider !== "pusher" || !cfg.key) return null; // Ably on the phone falls back to polling
  if (socket) return socket;
  try {
    const Pusher = (await import("pusher-js/react-native")).default as any;
    socket = new Pusher(cfg.key, {
      cluster: cfg.cluster || "ap2",
      authEndpoint: `${API_BASE}/api/co/chat/realtime/auth`,
      auth: { headers: { Cookie: `lms_token=${sessionToken() || ""}` } },
      forceTLS: true,
    });
    return socket;
  } catch {
    cfg = { provider: "none", pollMs: 5000 };
    return null;
  }
}

/** Listens on one channel; the returned function stops listening. */
export async function subscribe(channel: string, events: Record<string, (data: any) => void>) {
  const s = await connect();
  if (!s) return () => {};
  let ch = channels.get(channel);
  if (!ch) {
    ch = s.subscribe(channel);
    channels.set(channel, ch);
  }
  const bound = Object.entries(events);
  for (const [name, fn] of bound) ch.bind(name, fn);
  return () => {
    for (const [name, fn] of bound) ch.unbind(name, fn);
  };
}

export function closeLive() {
  try {
    socket?.disconnect?.();
  } catch {
    /* already gone */
  }
  socket = null;
  channels.clear();
}

/** Fast when there is no real-time service, a slow safety net when there is. */
export function poller(fn: () => void, ms?: number) {
  const every = isLive() ? Math.max(ms || 20000, 20000) : ms || cfg.pollMs || 5000;
  const t = setInterval(fn, every);
  return () => clearInterval(t);
}

/* ───────────────────────── Push ───────────────────────── */

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
});

/**
 * Asks once for permission and registers this phone. A refusal is not an error: the app works without
 * notifications, messages simply wait until it is opened.
 */
export async function registerForPush() {
  try {
    if (!Device.isDevice) return null; // a simulator has no push token
    const existing = await Notifications.getPermissionsAsync();
    const status = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    if (!status.granted) return null;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Messages and notices",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: BRAND.primary,
      });
    }
    const projectId = (Constants.expoConfig as any)?.extra?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await api("/co/chat/devices", { body: { token, platform: Platform.OS, appVersion: `${BRAND.version} (${BRAND.build})` } }).catch(() => undefined);
    return token;
  } catch {
    return null; // never let notifications stop the app from starting
  }
}

/** Called on sign-out, so a shared phone stops receiving someone else's messages. */
export async function unregisterPush() {
  try {
    const projectId = (Constants.expoConfig as any)?.extra?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await api(`/co/chat/devices?token=${encodeURIComponent(token)}`, { method: "DELETE" }).catch(() => undefined);
  } catch {
    /* nothing registered */
  }
  closeLive();
}

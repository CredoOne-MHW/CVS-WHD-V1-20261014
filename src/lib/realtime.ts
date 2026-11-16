/**
 * The browser side of real-time chat.
 *
 * One socket for the whole tab, shared by every channel the page listens on — a second page does not open
 * a second connection. When no real-time service is configured the same interface quietly polls instead, so
 * the chat screen is written once and works either way.
 */
import { api } from "./api";

export type RealtimeConfig = { provider: "pusher" | "ably" | "none"; key?: string; cluster?: string; authEndpoint?: string; pollMs?: number };
type Handler = (data: any) => void;

let socket: any = null;
let starting: Promise<any> | null = null;
let cfg: RealtimeConfig = { provider: "none", pollMs: 5000 };
const channels = new Map<string, any>();

export const realtimeConfig = () => cfg;
export const isLive = () => cfg.provider !== "none";

/** Opens the connection once. Safe to call on every mount. */
async function connect(c: RealtimeConfig) {
  cfg = c;
  if (c.provider === "none") return null;
  if (socket) return socket;
  if (starting) return starting;
  starting = (async () => {
    if (c.provider === "pusher") {
      const Pusher = (await import("pusher-js")).default as any;
      socket = new Pusher(c.key, { cluster: c.cluster || "ap2", authEndpoint: c.authEndpoint, forceTLS: true, enabledTransports: ["ws", "wss"] });
    } else if (c.provider === "ably") {
      const Ably = (await import("ably")).default as any;
      socket = new Ably.Realtime({ authUrl: c.authEndpoint, authMethod: "POST" });
    }
    return socket;
  })();
  try {
    return await starting;
  } catch {
    cfg = { provider: "none", pollMs: 5000 }; // the service could not be reached: fall back to polling
    return null;
  } finally {
    starting = null;
  }
}

/**
 * Listens on one channel. Returns the function that stops listening — call it when the screen closes, or the
 * tab keeps a subscription it no longer reads.
 */
export async function subscribe(c: RealtimeConfig, channel: string, events: Record<string, Handler>) {
  const s = await connect(c);
  if (!s) return () => {};
  let ch = channels.get(channel);
  if (!ch) {
    ch = cfg.provider === "pusher" ? s.subscribe(channel) : s.channels.get(channel);
    channels.set(channel, ch);
  }
  const bound: [string, Handler][] = [];
  for (const [name, fn] of Object.entries(events)) {
    const wrapped = cfg.provider === "ably" ? (msg: any) => fn(msg?.data) : fn;
    ch.bind ? ch.bind(name, wrapped) : ch.subscribe(name, wrapped);
    bound.push([name, wrapped]);
  }
  return () => {
    for (const [name, fn] of bound) (ch.unbind ? ch.unbind(name, fn) : ch.unsubscribe(name, fn));
  };
}

/** Closes everything — used when signing out. */
export function closeRealtime() {
  try {
    socket?.disconnect?.();
    socket?.close?.();
  } catch {
    /* already gone */
  }
  socket = null;
  channels.clear();
}

/**
 * Keeps something fresh: instantly when a real-time service is on, otherwise every few seconds. The caller
 * does not need to know which.
 */
export function poller(fn: () => void, ms?: number) {
  const every = ms || cfg.pollMs || 5000;
  const t = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return; // a hidden tab costs nothing
    fn();
  }, isLive() ? Math.max(every, 20000) : every); // live: a slow safety net only
  return () => clearInterval(t);
}

/** The notices showing right now, cached for a few seconds so every page does not ask again. */
let noticeCache: { at: number; items: any[] } | null = null;
export async function notices(fresh = false) {
  if (!fresh && noticeCache && Date.now() - noticeCache.at < 15000) return noticeCache.items;
  const r = await api<{ items: any[] }>("/co/chat/notices").catch(() => ({ items: [] as any[] }));
  noticeCache = { at: Date.now(), items: r.items || [] };
  return noticeCache.items;
}

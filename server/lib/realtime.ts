/**
 * Real-time delivery, through whichever managed service is configured.
 *
 * Vercel cannot hold a WebSocket open, so the socket lives with a managed service and this server only
 * publishes to it. Two are supported and the choice is one setting — nothing else in the platform knows
 * which is in use:
 *
 *   REALTIME_PROVIDER=pusher   PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET / PUSHER_CLUSTER (ap2 = Mumbai)
 *   REALTIME_PROVIDER=ably     ABLY_API_KEY
 *
 * With neither set, chat still works: messages are stored and read normally, and the apps fall back to
 * asking every few seconds. Nothing breaks — it is simply not instant.
 */
import { createHmac } from "crypto";

const env = (k: string) => (process.env[k] || "").trim();
export type Provider = "pusher" | "ably" | "none";

export function provider(): Provider {
  const choice = env("REALTIME_PROVIDER").toLowerCase();
  if (choice === "ably" || (!choice && env("ABLY_API_KEY"))) return env("ABLY_API_KEY") ? "ably" : "none";
  if (env("PUSHER_APP_ID") && env("PUSHER_KEY") && env("PUSHER_SECRET")) return "pusher";
  return "none";
}
export const realtimeOn = () => provider() !== "none";
export const cluster = () => env("PUSHER_CLUSTER") || "ap2"; // Mumbai

/** What a client needs to connect. The secret never leaves the server. */
export function clientConfig() {
  const p = provider();
  if (p === "pusher") return { provider: p, key: env("PUSHER_KEY"), cluster: cluster(), authEndpoint: "/api/co/chat/realtime/auth" };
  if (p === "ably") return { provider: p, authEndpoint: "/api/co/chat/realtime/auth" };
  return { provider: "none" as const, pollMs: 5000 };
}

let pusherClient: any = null;
async function pusher() {
  if (!pusherClient) {
    const Pusher = (await import("pusher")).default as any;
    pusherClient = new Pusher({ appId: env("PUSHER_APP_ID"), key: env("PUSHER_KEY"), secret: env("PUSHER_SECRET"), cluster: cluster(), useTLS: true });
  }
  return pusherClient;
}

/**
 * Sends an event to one or more channels. Never throws: a message that is stored but not pushed is a
 * message that arrives a few seconds later, which is far better than a failed send.
 */
export async function publish(channels: string | string[], event: string, data: any) {
  const list = (Array.isArray(channels) ? channels : [channels]).slice(0, 90); // the services cap a batch at 100
  if (!list.length) return { sent: false, reason: "no channels" };
  const p = provider();
  try {
    if (p === "pusher") {
      await (await pusher()).trigger(list, event, data);
      return { sent: true };
    }
    if (p === "ably") {
      const key = env("ABLY_API_KEY");
      await Promise.all(
        list.map((ch) =>
          fetch(`https://rest.ably.io/channels/${encodeURIComponent(ch)}/messages`, {
            method: "POST",
            headers: { Authorization: `Basic ${Buffer.from(key).toString("base64")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: event, data }),
            signal: AbortSignal.timeout(4000),
          })
        )
      );
      return { sent: true };
    }
  } catch (e: any) {
    return { sent: false, reason: e?.message };
  }
  return { sent: false, reason: "no realtime provider configured" };
}

/**
 * Lets a signed-in user listen on a private channel — but only one that belongs to them. The caller has
 * already checked that; this just signs it.
 */
export async function authorize(channel: string, socketId: string, userId: string) {
  const p = provider();
  if (p === "pusher") {
    const stringToSign = `${socketId}:${channel}`;
    const signature = createHmac("sha256", env("PUSHER_SECRET")).update(stringToSign).digest("hex");
    return { auth: `${env("PUSHER_KEY")}:${signature}` };
  }
  if (p === "ably") {
    // a token request the client exchanges itself, scoped to that one channel
    const [keyName, keySecret] = env("ABLY_API_KEY").split(":");
    const request: any = {
      keyName,
      ttl: 3600_000,
      capability: JSON.stringify({ [channel]: ["subscribe", "presence"] }),
      clientId: userId,
      timestamp: Date.now(),
      nonce: Math.random().toString(36).slice(2),
    };
    const text = `${request.keyName}\n${request.ttl}\n${request.capability}\n${request.clientId}\n${request.timestamp}\n${request.nonce}\n`;
    request.mac = createHmac("sha256", keySecret).update(text).digest("base64");
    return request;
  }
  throw new Error("Real-time is not configured");
}

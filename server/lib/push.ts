/**
 * Push notifications to the company's apps.
 *
 * The apps are built with Expo, so a push goes through Expo's own service, which hands it to FCM on Android
 * and APNs on iOS. That needs no key on this server: a device registers its Expo token when it signs in,
 * and a token that stops working is dropped after a few failures.
 *
 * A push is a courtesy, never the delivery itself — the message is already stored before this is called.
 */
import { PushDevice } from "../models";

const EXPO = "https://exp.host/--/api/v2/push/send";
const CHUNK = 90;

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: string | null;
  channelId?: string; // Android notification channel
}

/** Registers (or refreshes) one device for a user. */
export async function registerDevice(companyId: any, userId: any, token: string, platform: string, appVersion?: string) {
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(token) && !/^[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("That does not look like a push token");
  return PushDevice.findOneAndUpdate(
    { token },
    { $set: { companyId, userId, token, platform: ["android", "ios", "web"].includes(platform) ? platform : "android", appVersion, lastSeenAt: new Date(), failures: 0 } },
    { upsert: true, new: true }
  );
}

export const forgetDevice = (token: string) => PushDevice.deleteOne({ token });

/**
 * Tells a company's phones that a newer version of their app is out.
 *
 * Only devices that are *not* already on this version are told, so nobody who installed it five minutes ago
 * is nagged about it. The tap target travels in `data`, so the app can open the download page itself rather
 * than making somebody hunt for it.
 */
export async function pushAppUpdate(companyId: any, platform: string, version: string, url: string, appName?: string) {
  const devices = await PushDevice.find({ companyId, platform, failures: { $lt: 5 } }).select("token appVersion userId").lean<any[]>();
  const stale = devices.filter((d) => String(d.appVersion || "") !== String(version));
  if (!stale.length) return { sent: 0, reason: "every device is already on this version" };
  return pushToTokens(
    stale.map((d) => d.token),
    {
      title: `Update available${appName ? ` · ${appName}` : ""}`,
      body: `Version ${version} is ready. Tap to download and install it.`,
      data: { kind: "app_update", version, url, platform },
      channelId: "updates",
    }
  );
}

/** Sends to every device of the given users. Returns how many were accepted. */
export async function pushToUsers(companyId: any, userIds: any[], msg: PushMessage) {
  const ids = userIds.map(String).filter(Boolean);
  if (!ids.length) return { sent: 0 };
  const devices = await PushDevice.find({ companyId, userId: { $in: ids }, failures: { $lt: 5 } }).select("token userId").lean<any[]>();
  if (!devices.length) return { sent: 0, reason: "no registered devices" };
  return pushToTokens(devices.map((d) => d.token), msg);
}

/** The send itself, given the tokens. Shared, so retries and dead-token handling exist in one place. */
export async function pushToTokens(tokens: string[], msg: PushMessage) {
  const devices = tokens.filter(Boolean).map((token) => ({ token }));
  if (!devices.length) return { sent: 0, reason: "no registered devices" };

  let sent = 0;
  for (let i = 0; i < devices.length; i += CHUNK) {
    const slice = devices.slice(i, i + CHUNK);
    const body = slice.map((d) => ({
      to: d.token,
      title: msg.title.slice(0, 120),
      body: msg.body.slice(0, 400),
      data: msg.data || {},
      sound: msg.sound === null ? undefined : msg.sound || "default",
      badge: msg.badge,
      channelId: msg.channelId || "default",
      priority: "high",
    }));
    try {
      const res = await fetch(EXPO, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      const json: any = await res.json().catch(() => ({}));
      const tickets: any[] = json?.data || [];
      for (let k = 0; k < tickets.length; k++) {
        const t = tickets[k];
        if (t?.status === "ok") sent++;
        // a token the device no longer has: count it, and stop trying after a few
        else if (t?.details?.error === "DeviceNotRegistered") await PushDevice.deleteOne({ token: slice[k].token }).catch(() => {});
        else await PushDevice.updateOne({ token: slice[k].token }, { $inc: { failures: 1 } }).catch(() => {});
      }
    } catch {
      /* a push that did not go out is not an error the user should see */
    }
  }
  return { sent };
}

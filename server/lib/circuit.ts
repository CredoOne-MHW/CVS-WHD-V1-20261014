/**
 * Circuit breaker per external provider host (WhatsApp APIs, AI providers).
 *
 * After 5 consecutive retryable failures (network error, 5xx, 429) the circuit OPENS: calls fail fast for 1 min, then
 * 2, 4, 8 … up to 30 min while the provider keeps failing. The first call after that window is the trial ("half-open");
 * one success closes the circuit again. Messages that hit an open circuit are not lost — they're queued for redelivery
 * (see whatsapp.ts). State is shared by all instances (main database) with a 5-second local cache.
 */
import { ProviderState } from "../models";

const THRESHOLD = 5;
const local = new Map<string, { openUntil: number; at: number }>();

export const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "unknown";
  }
};
export const retryable = (status: number) => status === 0 || status === 429 || status >= 500;

/** Epoch ms the circuit stays open until, or 0 when calls may go through. */
export async function openUntil(host: string): Promise<number> {
  const c = local.get(host);
  if (c && Date.now() - c.at < 5000) return c.openUntil > Date.now() ? c.openUntil : 0;
  const s = await ProviderState.findById(host).select("openUntil").lean<any>().catch(() => null);
  const until = s?.openUntil ? new Date(s.openUntil).getTime() : 0;
  local.set(host, { openUntil: until, at: Date.now() });
  return until > Date.now() ? until : 0;
}

export async function record(host: string, ok: boolean, error?: string) {
  try {
    if (ok) {
      const c = local.get(host);
      if (c?.openUntil || !c) await ProviderState.updateOne({ _id: host, failures: { $gt: 0 } }, { $set: { failures: 0, openUntil: null, lastSuccessAt: new Date() } });
      local.set(host, { openUntil: 0, at: Date.now() });
      return;
    }
    const s = await ProviderState.findOneAndUpdate({ _id: host }, { $inc: { failures: 1 }, $set: { lastError: String(error || "").slice(0, 300), lastFailureAt: new Date() } }, { upsert: true, new: true }).lean<any>();
    if (s && s.failures >= THRESHOLD) {
      const until = new Date(Date.now() + Math.min(30 * 60_000, 60_000 * 2 ** (s.failures - THRESHOLD)));
      await ProviderState.updateOne({ _id: host }, { $set: { openUntil: until } });
      local.set(host, { openUntil: until.getTime(), at: Date.now() });
    }
  } catch {
    /* breaker bookkeeping must never break a send */
  }
}

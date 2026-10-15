/**
 * Two-level cache: per-instance memory (microseconds) + optional Upstash Redis (shared by every
 * serverless instance). Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to enable Redis.
 * Invalidation is generation-based, so one `invalidate("tenant:")` clears every instance within ~5 s.
 */
type Entry = { at: number; ttl: number; v: unknown };
const mem = new Map<string, Entry>();
const MAX = 5000;

const redisOn = () => !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
export async function redis(cmd: (string | number)[]): Promise<any> {
  if (!redisOn()) return null;
  try {
    const r = await fetch(process.env.UPSTASH_REDIS_REST_URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(800),
    });
    return (await r.json())?.result ?? null;
  } catch {
    return null; // cache must never take the app down
  }
}

const gens = new Map<string, { at: number; g: string }>();
async function gen(prefix: string) {
  const hit = gens.get(prefix);
  if (hit && Date.now() - hit.at < 5000) return hit.g;
  const g = String((await redis(["GET", `gen:${prefix}`])) ?? "0");
  gens.set(prefix, { at: Date.now(), g });
  return g;
}
const prefixOf = (key: string) => key.slice(0, key.indexOf(":") + 1);

export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const m = mem.get(key);
  if (m && now - m.at < m.ttl * 1000) return m.v as T;
  let fullKey = key;
  if (redisOn()) {
    fullKey = `${key}#${await gen(prefixOf(key))}`;
    const hit = await redis(["GET", fullKey]);
    if (hit != null) {
      const v = JSON.parse(hit) as T;
      remember(key, ttlSec, v);
      return v;
    }
  }
  const v = await load();
  remember(key, ttlSec, v);
  if (redisOn()) redis(["SET", fullKey, JSON.stringify(v ?? null), "EX", ttlSec]);
  return v;
}

function remember(key: string, ttl: number, v: unknown) {
  if (mem.size >= MAX) mem.delete(mem.keys().next().value as string);
  mem.set(key, { at: Date.now(), ttl, v });
}

export async function invalidate(prefix: string) {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  gens.delete(prefix);
  await redis(["INCR", `gen:${prefix}`]);
}

/** Fixed-window rate limit shared across instances when Redis is on (memory otherwise). */
const hits = new Map<string, { n: number; reset: number }>();
export async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  if (redisOn()) {
    const k = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
    const n = await redis(["INCR", k]);
    if (n === 1) redis(["EXPIRE", k, windowSec]);
    if (typeof n === "number") return n <= max;
  }
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) {
    if (hits.size > 20000) hits.clear();
    hits.set(key, { n: 1, reset: now + windowSec * 1000 });
    return true;
  }
  return ++e.n <= max;
}

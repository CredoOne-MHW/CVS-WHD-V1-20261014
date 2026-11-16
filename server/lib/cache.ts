/**
 * Two-level cache: per-instance memory (microseconds) + optional Upstash Redis (shared by every
 * serverless instance). Invalidation is generation-based, so one `invalidate("tenant:")` clears every
 * instance within ~5 s.
 *
 * The REST endpoint is found by itself, because Vercel's Upstash and KV integrations name the pair
 * differently depending on how the store was added:
 *
 *   UPSTASH_REDIS_REST_URL            + UPSTASH_REDIS_REST_TOKEN            (set by hand)
 *   KV_REST_API_URL                   + KV_REST_API_TOKEN                   (Vercel KV)
 *   <STORE>_KV_REST_API_URL           + <STORE>_KV_REST_API_TOKEN           (Upstash integration, prefixed per store)
 *
 * Any prefixed pair is accepted, so a store added from the Vercel marketplace needs no renaming.
 * A read-only token is ignored: the cache has to write.
 */
type Entry = { at: number; ttl: number; v: unknown };
const mem = new Map<string, Entry>();
const MAX = 5000;

/** The first REST url + token pair present in the environment, worked out once. */
let creds: { url: string; token: string } | null | undefined;
function redisCreds() {
  if (creds !== undefined) return creds;
  const env = process.env as Record<string, string | undefined>;
  const pairs: [string | undefined, string | undefined][] = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
  ];
  // …plus every <STORE>_KV_REST_API_URL / _TOKEN pair an integration may have added
  for (const key of Object.keys(env)) {
    if (!key.endsWith("_KV_REST_API_URL")) continue;
    const stem = key.slice(0, -"_KV_REST_API_URL".length);
    pairs.push([env[key], env[`${stem}_KV_REST_API_TOKEN`]]);
  }
  const hit = pairs.find(([u, t]) => u && t && /^https?:\/\//.test(u));
  creds = hit ? { url: hit[0]!, token: hit[1]! } : null;
  return creds;
}
/** Which variables the cache is using — shown in Super Admin › System Health. */
export const redisSource = () => {
  const env = process.env as Record<string, string | undefined>;
  const c = redisCreds();
  if (!c) return null;
  const name = Object.keys(env).find((k) => env[k] === c.url && k.endsWith("URL"));
  return name || "UPSTASH_REDIS_REST_URL";
};
const redisOn = () => !!redisCreds();

export async function redis(cmd: (string | number)[]): Promise<any> {
  const c = redisCreds();
  if (!c) return null;
  try {
    const r = await fetch(c.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
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

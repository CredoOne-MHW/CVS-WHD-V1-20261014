/**
 * API latency metrics. Every request is timed and added to an hourly histogram per route (PerfStat, main database), so
 * p50 / p95 can be read across all serverless instances — see Super Admin › System Health. Samples are buffered in
 * memory and written in one bulk upsert every ~15 s, so measuring costs nothing on the request path.
 */
import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { PerfStat } from "../models";
import { BUCKETS } from "../../shared/perf";

type Agg = { route: string; method: string; hour: number; count: number; errors: number; sum: number; max: number; b: Record<string, number> };
const buf = new Map<string, Agg>();
let lastFlush = Date.now();
let flushing = false;

const bucketOf = (ms: number) => BUCKETS.findIndex((b) => ms <= b);

function add(route: string, method: string, ms: number, error: boolean) {
  const hour = Math.floor(Date.now() / 3600_000) * 3600_000;
  const k = `${hour}|${method}|${route}`;
  let a = buf.get(k);
  if (!a) buf.set(k, (a = { route, method, hour, count: 0, errors: 0, sum: 0, max: 0, b: {} }));
  a.count++;
  if (error) a.errors++;
  a.sum += ms;
  a.max = Math.max(a.max, ms);
  const i = String(bucketOf(ms));
  a.b[i] = (a.b[i] || 0) + 1;
}

export async function flushMetrics(force = false) {
  if (flushing || !buf.size || (!force && Date.now() - lastFlush < 15_000 && buf.size < 200)) return;
  flushing = true;
  const items = [...buf.values()];
  buf.clear();
  lastFlush = Date.now();
  try {
    await PerfStat.bulkWrite(
      items.map((a) => ({
        updateOne: {
          filter: { hour: new Date(a.hour), route: a.route, method: a.method },
          update: { $inc: { count: a.count, errors: a.errors, sum: a.sum, ...Object.fromEntries(Object.entries(a.b).map(([i, n]) => [`b.${i}`, n])) }, $max: { max: a.max } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch {
    /* metrics are best effort */
  } finally {
    flushing = false;
  }
}

/** Collapse ids so /leads/6ad1… and /leads/6ad2… are one route. */
const normalise = (p: string) => p.replace(/\/[a-f0-9]{24}(?=\/|$)/g, "/:id").replace(/\/\d+(?=\/|$)/g, "/:n");

/** Times the request, adds X-Request-Id and a Server-Timing header, records the sample when the response finishes. */
export function metrics(req: Request, res: Response, next: NextFunction) {
  const t0 = process.hrtime.bigint();
  const id = String(req.headers["x-vercel-id"] || req.headers["x-request-id"] || randomBytes(8).toString("hex")).slice(0, 80);
  (req as any).requestId = id;
  res.setHeader("X-Request-Id", id);
  const writeHead = res.writeHead;
  (res as any).writeHead = function (this: Response, ...args: any[]) {
    try {
      if (!res.headersSent) res.setHeader("Server-Timing", `app;dur=${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)}`);
    } catch {}
    return (writeHead as any).apply(this, args);
  };
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const route = req.route?.path ? normalise(`${req.baseUrl}${req.route.path}`) : normalise(req.baseUrl || req.path).replace(/^\/api\/(intake|public)\/.*/, "/api/$1/*");
    if (!route.startsWith("/api") || route.startsWith("/api/cron")) return; // cron jobs have their own time budget
    add(route, req.method, ms, res.statusCode >= 500);
    flushMetrics().catch(() => undefined);
  });
  next();
}

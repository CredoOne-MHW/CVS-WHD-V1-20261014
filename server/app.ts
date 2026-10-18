import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { connectDB } from "./lib/db";
import { rateLimit } from "./lib/cache";
import { metrics } from "./lib/metrics";
import { errorHandler, HttpError } from "./lib/http";
import { requestHost, isPlatformHost, platformBranding, loadPlatformBranding, baseDomain, baseSource, configuredBases, hostContext, resolveHost } from "./lib/tenant";
import { requireAuth } from "./middleware/auth";
import { activityLogger, logActivity } from "./middleware/activity";
import authRoutes from "./routes/auth";
import saRoutes from "./routes/sa";
import coRoutes from "./routes/co";
import publicRoutes from "./routes/public";

/** Strip Mongo operators ($gt, $where…) and prototype keys from untrusted input (NoSQL-injection guard). */
function sanitize(v: any, depth = 0): any {
  if (depth > 10 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => sanitize(x, depth + 1));
  for (const k of Object.keys(v)) {
    if (k.startsWith("$") || k === "__proto__" || k === "constructor" || k === "prototype") delete v[k];
    else v[k] = sanitize(v[k], depth + 1);
  }
  return v;
}

/** CSRF defence for cookie-authenticated calls: state-changing requests must come from this same site. */
function sameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser clients (no cookies sent cross-site anyway)
  try {
    if (new URL(origin).hostname.toLowerCase() === requestHost(req)) return next();
  } catch {}
  next(new HttpError(403, "Cross-site request blocked"));
}

/**
 * Express API. Mounted inside Next.js at /api/* (src/pages/api/[[...path]].ts),
 * so the whole product ships as one Vercel deployment.
 */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag"); // API responses are per-user; caching is set explicitly
  app.set("trust proxy", 1);
  app.set("query parser", "simple"); // no nested objects in query strings → no operator injection via ?a[$ne]=

  app.use(metrics); // latency histogram per route + X-Request-Id + Server-Timing
  app.use(hostContext);
  app.use(
    express.json({
      limit: "2mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString("utf8"); // kept for HMAC signature checks on intake
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.body = sanitize(req.body);
    res.setHeader("Cache-Control", "no-store"); // default for API; public routes override
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  /** Website / landing-page forms post to intake from other domains: open CORS, never with cookies. Answered before any DB work. */
  // AI endpoint: preflight is answered here; the per-endpoint origin allow-list is enforced on the real request
  app.options("/api/ai/v1/chat", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", String(req.headers.origin || "*"));
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Api-Key");
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).end();
  });

  app.use(["/api/intake", "/api/forms"], (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Idempotency-Key, X-Api-Key, X-Signature");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  // Quick deployment check: open /api/health on any address to see how it is resolved.
  app.get("/api/health", async (req, res) => {
    const host = requestHost(req);
    let resolved = "platform";
    try {
      await connectDB();
      resolved = (await resolveHost(host)).kind;
    } catch {
      resolved = isPlatformHost(host) ? "platform" : "unknown (database unreachable)";
    }
    res.json({
      ok: true,
      time: new Date().toISOString(),
      host,
      resolvedAs: resolved,
      baseDomain: baseDomain() || null,
      baseDomainSource: baseSource() === "env" ? "APP_BASE_DOMAIN" : "auto-detected from this address",
      configuredBaseDomains: configuredBases(),
      vercelEnv: process.env.VERCEL_ENV || "local",
      mongoConfigured: !!process.env.MONGODB_URI,
      jwtConfigured: !!process.env.JWT_SECRET,
      redisCache: !!process.env.UPSTASH_REDIS_REST_URL,
    });
  });

  // The platform login must render even if the database is unreachable.
  app.get("/api/public/branding", async (req, res, next) => {
    const host = requestHost(req);
    const platform = async () => {
      // Super Admin's saved look (template, colours, texts) — never blocks the page for more than 1.5 s
      await Promise.race([connectDB().then(() => loadPlatformBranding()), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=600");
      res.json({ ...platformBranding(), host });
    };
    if (isPlatformHost(host)) return platform();
    try {
      await connectDB();
    } catch {
      return platform();
    }
    next();
  });

  app.use(async (req, _res, next) => {
    try {
      await connectDB();
    } catch (e: any) {
      console.error("MongoDB connection failed:", e?.message);
      return next(new HttpError(503, "Database unavailable. Check MONGODB_URI and Atlas network access (allow 0.0.0.0/0 for Vercel)."));
    }
    // resolve the tenant/base domain for this address once (cached) so every handler sees the right base
    try {
      await resolveHost(requestHost(req));
    } catch {}
    next();
  });

  /** Browser crash reports → Activity Logs (Error status) + Vercel function logs, so a client error is never invisible. */
  app.post("/api/client-error", sameOrigin, requireAuth, async (req, res) => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (!(await rateLimit(`clienterr:${req.auth!.userId}`, 20, 600))) return res.status(204).end();
    const b = req.body || {};
    const clip = (v: any, n: number) => String(v ?? "").slice(0, n);
    const payload = { message: clip(b.message, 500), where: clip(b.where, 80), url: clip(b.url, 300), stack: clip(b.stack, 4000), componentStack: clip(b.componentStack, 2000), userAgent: clip(req.headers["user-agent"], 300), build: clip(b.build, 40) };
    console.error("[client-error]", req.auth!.email, JSON.stringify(payload));
    await logActivity({ scope: req.auth!.scope, companyId: req.auth!.companyId, userId: req.auth!.userId, userLabel: `${req.auth!.name} <${req.auth!.email}>`, impersonatedBy: req.auth!.impersonatedBy, action: "Screen error", module: "client", item: payload.where || payload.url, response: 500, error: payload.message, payload, ip });
    res.status(204).end();
  });

  // abuse / runaway-client protection: per IP on public endpoints, per signed-in user on the consoles
  const ipOf = (req: Request) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const limit = (key: (req: Request) => string, max: number) => async (req: Request, res: Response, next: NextFunction) => {
    if (await rateLimit(key(req), max, 60)) return next();
    res.setHeader("Retry-After", "60");
    next(new HttpError(429, "Too many requests — please slow down and try again in a minute."));
  };
  app.use(["/api/intake", "/api/public", "/api/ai/v1"], limit((req) => `ip:${ipOf(req)}`, 300));

  app.use("/api", publicRoutes); // intake, hosted forms, cron, branding
  app.use("/api/auth", sameOrigin, authRoutes);
  const perUser = limit((req) => `user:${req.auth!.userId}`, 600);
  app.use("/api/sa", sameOrigin, requireAuth, perUser, activityLogger, saRoutes);
  app.use("/api/co", sameOrigin, requireAuth, perUser, activityLogger, coRoutes);

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}

const g = globalThis as unknown as { __lmsApp?: express.Express };
export const app = g.__lmsApp ?? (g.__lmsApp = createApp());

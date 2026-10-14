import express from "express";
import cookieParser from "cookie-parser";
import { connectDB } from "./lib/db";
import { errorHandler, HttpError } from "./lib/http";
import { requireAuth } from "./middleware/auth";
import { activityLogger } from "./middleware/activity";
import authRoutes from "./routes/auth";
import saRoutes from "./routes/sa";
import coRoutes from "./routes/co";
import publicRoutes from "./routes/public";

/**
 * Express API. Mounted inside Next.js at /api/* (src/pages/api/[[...path]].ts),
 * so the whole product ships as one Vercel deployment.
 */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // keep raw body for HMAC signature checks on intake
  app.use(
    express.json({
      limit: "2mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use(async (_req, _res, next) => {
    try {
      await connectDB();
      next();
    } catch (e: any) {
      console.error("MongoDB connection failed:", e?.message);
      next(new HttpError(503, "Database unavailable. Check MONGODB_URI and Atlas network access (allow 0.0.0.0/0 for Vercel)."));
    }
  });

  app.use("/api", publicRoutes); // intake, hosted forms, cron
  app.use("/api/auth", authRoutes);
  app.use("/api/sa", requireAuth, activityLogger, saRoutes);
  app.use("/api/co", requireAuth, activityLogger, coRoutes);

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}

const g = globalThis as unknown as { __lmsApp?: express.Express };
export const app = g.__lmsApp ?? (g.__lmsApp = createApp());

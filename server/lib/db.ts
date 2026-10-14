import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User, Plan } from "../models";
import { COMPANY_MODULES, PLAN_TIERS, fullPerm, noPerm, type PermMap } from "../../shared/constants";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null; bootstrapped: boolean };
const g = globalThis as unknown as { __lmsMongo?: Cache };
const cache: Cache = g.__lmsMongo ?? (g.__lmsMongo = { conn: null, promise: null, bootstrapped: false });

/** Re-uses one connection across warm serverless invocations. */
export async function connectDB() {
  if (cache.conn) return cache.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (!cache.promise) {
    mongoose.set("strictQuery", true);
    cache.promise = mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB || "leadhive",
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      bufferCommands: false,
    });
  }
  try {
    cache.conn = await cache.promise;
  } catch (e) {
    cache.promise = null;
    throw e;
  }
  if (!cache.bootstrapped) {
    await bootstrap();
    cache.bootstrapped = true;
  }
  return cache.conn;
}

/** First run: create the Super Admin from env and seed default plans. Idempotent. */
async function bootstrap() {
  const email = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const hasSuper = await User.exists({ scope: "super" });
  if (!hasSuper && email && password) {
    await User.updateOne(
      { email },
      {
        $setOnInsert: {
          scope: "super",
          name: "Super Admin",
          email,
          passwordHash: await bcrypt.hash(password, 12),
          isOwner: true,
          active: true,
        },
      },
      { upsert: true }
    );
  }

  const defaults: Record<string, string[]> = {
    Trial: ["dashboard", "leads", "integrations", "wa_webhooks", "wa_logs"],
    Standard: ["dashboard", "leads", "integrations", "activity_logs", "wa_webhooks", "wa_logs", "roles"],
    Pro: COMPANY_MODULES.map((m) => m.key),
    Enterprise: COMPANY_MODULES.map((m) => m.key),
  };
  for (const tier of PLAN_TIERS) {
    const permissions: PermMap = {};
    for (const mod of COMPANY_MODULES) permissions[mod.key] = defaults[tier].includes(mod.key) ? fullPerm() : noPerm();
    await Plan.updateOne({ name: tier }, { $setOnInsert: { name: tier, permissions } }, { upsert: true });
  }
}

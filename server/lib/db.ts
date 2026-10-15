import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User, Plan, AiProvider, AiAllocation } from "../models";
import { invalidate } from "./cache";
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
      maxPoolSize: Number(process.env.MONGODB_POOL_SIZE || 5), // small per instance: serverless scales out, not up
      minPoolSize: 0,
      maxIdleTimeMS: 30_000,
      compressors: ["zlib"],
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

  // Default LLM providers (Super Admin can remove any of them or add more from the dropdown)
  const providers = [
    { key: "openrouter", name: "OpenRouter (300+ models)", apiStyle: "openai", baseUrl: "https://openrouter.ai/api/v1", modelsUrl: "https://openrouter.ai/api/v1/models", extraHeaders: { "X-Title": "CredoOne LMS" } },
    { key: "anthropic", name: "Anthropic", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com" },
    { key: "openai", name: "OpenAI", apiStyle: "openai", baseUrl: "https://api.openai.com/v1", modelsUrl: "https://api.openai.com/v1/models" },
    { key: "google", name: "Google Gemini", apiStyle: "google", baseUrl: "https://generativelanguage.googleapis.com" },
    { key: "groq", name: "Groq", apiStyle: "openai", baseUrl: "https://api.groq.com/openai/v1", modelsUrl: "https://api.groq.com/openai/v1/models" },
    { key: "mistral", name: "Mistral", apiStyle: "openai", baseUrl: "https://api.mistral.ai/v1", modelsUrl: "https://api.mistral.ai/v1/models" },
    { key: "deepseek", name: "DeepSeek", apiStyle: "openai", baseUrl: "https://api.deepseek.com/v1", modelsUrl: "https://api.deepseek.com/v1/models" },
  ];
  if (!(await AiProvider.estimatedDocumentCount())) await AiProvider.insertMany(providers).catch(() => undefined);

  // Every tier starts with every module ticked; Super Admin narrows a plan from Plan › grid.
  const all = COMPANY_MODULES.map((m) => m.key);
  for (const tier of PLAN_TIERS) {
    const permissions: PermMap = {};
    for (const mod of COMPANY_MODULES) permissions[mod.key] = all.includes(mod.key) ? fullPerm() : noPerm();
    await Plan.updateOne({ name: tier }, { $setOnInsert: { name: tier, permissions } }, { upsert: true });
  }

  const meta = mongoose.connection.db!.collection<{ _id: string; at: Date }>("meta");
  let changed = false;

  // One-time (v2): Report, Role Management, Activity Logs and AI Agent switched on for every existing plan
  // (earlier seeds left them off for Trial/Standard, which hid them from company sidebars).
  if (!(await meta.findOne({ _id: "plans_v2" }))) {
    const set: any = {};
    for (const k of ["reports", "roles", "activity_logs", "ai_agents"]) set[`permissions.${k}`] = fullPerm();
    await Plan.updateMany({}, { $set: set });
    await meta.updateOne({ _id: "plans_v2" }, { $set: { at: new Date() } }, { upsert: true });
    changed = true;
  }

  // Modules added later: ticked on every plan by default (Super Admin can untick per plan).
  for (const plan of await Plan.find().lean<any[]>()) {
    const missing = COMPANY_MODULES.filter((m) => !plan.permissions?.[m.key]);
    if (!missing.length) continue;
    const set: any = {};
    for (const m of missing) set[`permissions.${m.key}`] = fullPerm();
    await Plan.updateOne({ _id: plan._id }, { $set: set });
    changed = true;
  }
  if (changed) await invalidate("auth:").catch(() => undefined);

  // One-time (v3): AI allocations get a cycle (start / monthly renewal) so the Allocation tab can manage them;
  // the new read-only "Subscription" module is ticked on every plan.
  if (!(await meta.findOne({ _id: "alloc_v3" }))) {
    const { nextRenewal } = await import("../../shared/billing");
    const now = new Date();
    for (const a of await AiAllocation.find({ startDate: null }).select("createdAt").lean<any[]>()) {
      const start = a.createdAt || now;
      await AiAllocation.updateOne({ _id: a._id }, { $set: { allocated: true, startDate: start, frequency: "monthly", renewalDate: nextRenewal(start, "monthly", now) } });
    }
    await Plan.updateMany({}, { $set: { "permissions.subscription": { create: false, read: true, update: false, delete: false } } });
    await meta.updateOne({ _id: "alloc_v3" }, { $set: { at: now } }, { upsert: true });
    await invalidate("auth:").catch(() => undefined);
  }

  // One-time (v2): move existing logos/banners/knowledge files into <Company Name>/logo · /banner · /brain.
  // Runs in the background so the first request isn't delayed; idempotent if an instance stops midway.
  if (process.env.S3_BUCKET && !(await meta.findOne({ _id: "s3_layout_v2" }))) {
    import("./s3")
      .then(({ relayoutAll }) => relayoutAll())
      .then(() => meta.updateOne({ _id: "s3_layout_v2" }, { $set: { at: new Date() } }, { upsert: true }))
      .catch((e) => console.warn("S3 relayout:", e?.message));
  }
}

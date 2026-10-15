import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User, Plan, AiProvider } from "../models";
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
  // Modules added after a plan was created: Pro/Enterprise get them, other plans start unticked.
  for (const plan of await Plan.find().lean<any[]>()) {
    const missing = COMPANY_MODULES.filter((m) => !plan.permissions?.[m.key]);
    if (!missing.length) continue;
    const set: any = {};
    for (const m of missing) set[`permissions.${m.key}`] = ["Pro", "Enterprise"].includes(plan.name) ? fullPerm() : noPerm();
    await Plan.updateOne({ _id: plan._id }, { $set: set });
  }
}

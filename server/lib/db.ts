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

  // One-time: allocations record the database their AI may read (the company's own)
  if (!(await meta.findOne({ _id: "alloc_db_v1" }))) {
    const { Company } = await import("../models");
    for (const c of await Company.find({}).select("dbName code").lean<any[]>()) await AiAllocation.updateMany({ companyId: c._id, dbName: null }, { $set: { dbName: c.dbName || c.code } });
    await meta.updateOne({ _id: "alloc_db_v1" }, { $set: { at: new Date() } }, { upsert: true });
  }

  // Companies created before per-company databases: their data is moved in the background (and on first use)
  if (!(await meta.findOne({ _id: "tenantdb_v1" }))) {
    import("./tenantdb")
      .then(({ migrateAll }) => migrateAll())
      .then(async (r) => {
        if (r.every((x) => x.ok)) await meta.updateOne({ _id: "tenantdb_v1" }, { $set: { at: new Date() } }, { upsert: true });
        else console.warn("company database move:", r);
      })
      .catch((e) => console.warn("company database move:", e?.message));
  }

  // One-time: the Google Search (keyword prospecting) connector was retired in favour of Google Ads lead forms
  // (v2: sweeps every company database — v1 relied on the key registry, which can miss older connectors)
  if (!(await meta.findOne({ _id: "gsearch_off_v2" }))) {
    const { ConnectorKey, tenantModelFor } = await import("../models");
    const { forEachCompanyDb } = await import("./tenantdb");
    const off = { $set: { active: false } };
    await forEachCompanyDb(async (c) => (c.db ? tenantModelFor("Connector", c.db).updateMany({ type: "google_search" }, off) : null), { includeDeleted: true });
    await mongoose.connection.collection("connectors").updateMany({ type: "google_search" }, off); // not-yet-moved companies
    await ConnectorKey.updateMany({ type: "google_search" }, off);
    await meta.updateOne({ _id: "gsearch_off_v2" }, { $set: { at: new Date() } }, { upsert: true });
  }

  // One-time: new Lead index (public profile link) in every company database — background, idempotent
  if (!(await meta.findOne({ _id: "lead_profile_idx_v1" }))) {
    import("./tenantdb")
      .then(async ({ forEachCompanyDb, provisionDb }) => {
        await forEachCompanyDb(async (c) => (c.db ? provisionDb(c.db) : null), { concurrency: 4 });
        await meta.updateOne({ _id: "lead_profile_idx_v1" }, { $set: { at: new Date() } }, { upsert: true });
      })
      .catch((e) => console.warn("lead index:", e?.message));
  }

  // One-time: the do-not-collect list (Suppression) needs its unique index in every existing company database
  if (!(await meta.findOne({ _id: "suppression_idx_v1" }))) {
    const { tenantModelFor } = await import("../models");
    const { forEachCompanyDb } = await import("./tenantdb");
    await forEachCompanyDb(async (c) => (c.db ? tenantModelFor("Suppression", c.db).collection.createIndex({ hash: 1 }, { unique: true }).catch(() => undefined) : null), { includeDeleted: true });
    await meta.updateOne({ _id: "suppression_idx_v1" }, { $set: { at: new Date() } }, { upsert: true });
  }

  // Company databases get every collection + index added since they were created (Client module, support tickets, payments).
  // Runs in the background; idempotent (existing indexes are left as they are). Bump the version when models gain indexes.
  if (!(await meta.findOne({ _id: "tenant_indexes_v2" }))) {
    import("./tenantdb")
      .then(async ({ forEachCompanyDb, provisionDb }) => {
        await forEachCompanyDb(async (c) => (c.db ? provisionDb(c.db).catch((e: any) => console.warn(`indexes for ${c.db}:`, e?.message)) : null), { includeDeleted: true, concurrency: 3 });
        await meta.updateOne({ _id: "tenant_indexes_v2" }, { $set: { at: new Date() } }, { upsert: true });
      })
      .catch((e) => console.warn("tenant indexes:", e?.message));
  }

  // One-time repair: a partial lead update (the Status dropdown) used to blank the lead's name. Where the original
  // channel payload is still stored on the lead, the name is recovered from it. Runs in the background.
  if (!(await meta.findOne({ _id: "lead_name_repair_v1" }))) {
    Promise.all([import("./tenantdb"), import("../models"), import("./intake")])
      .then(async ([{ forEachCompanyDb }, { Lead }, { mapFields }]) => {
        const nameIn = (raw: any): string => {
          if (!raw || typeof raw !== "object") return "";
          const ga = Array.isArray(raw.user_column_data) ? raw.user_column_data.find((c: any) => c.column_id === "FULL_NAME")?.string_value : "";
          const im = raw.RESPONSE?.SENDER_NAME || raw.body?.RESPONSE?.SENDER_NAME || raw.SENDER_NAME;
          const cands = [ga, im, raw.prospect?.name, mapFields(raw).name, raw.billing && [raw.billing.first_name, raw.billing.last_name].filter(Boolean).join(" "), raw.customer && [raw.customer.first_name, raw.customer.last_name].filter(Boolean).join(" ")];
          return String(cands.find((x) => x && String(x).trim() && String(x).trim() !== "NA") || "").trim().slice(0, 150);
        };
        let fixed = 0;
        await forEachCompanyDb(async (c) => {
          if (!c.db) return;
          const rows = await Lead.find({ companyId: c._id, name: "", deletedAt: null, "attribution.raw": { $exists: true } }).select("attribution.raw").limit(20000).lean<any[]>();
          for (const l of rows) {
            const name = (l.attribution || []).map((a: any) => nameIn(a.raw)).find(Boolean);
            if (name) fixed += (await Lead.updateOne({ _id: l._id, name: "" }, { $set: { name } })).modifiedCount;
          }
        }, { concurrency: 3 });
        await meta.updateOne({ _id: "lead_name_repair_v1" }, { $set: { at: new Date(), fixed } }, { upsert: true });
        if (fixed) console.log(`lead names restored: ${fixed}`);
      })
      .catch((e) => console.warn("lead name repair:", e?.message));
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

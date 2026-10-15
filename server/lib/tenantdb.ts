import mongoose from "mongoose";
import { Company, TENANT_MODELS, tenantModelFor, ConnectorKey } from "../models";
import { cached, invalidate } from "./cache";
import { runInDb } from "./context";

/**
 * One MongoDB database per company, named exactly as the company code (e.g. "WHD").
 * The platform database (MONGODB_DB) keeps identity and platform data: users, companies, plans, AI models,
 * allocations, subscriptions, Super Admin webhooks/logs. Everything a company owns lives in its own database.
 */
const RESERVED = new Set(["admin", "local", "config", "test"]);

export function dbNameFromCode(code: string) {
  return String(code || "").trim();
}

/** MongoDB rules: ≤ 38 chars on Atlas, no / \ . " $ * < > : | ? or spaces, not a system db, not the platform db. */
export function validateDbName(name: string) {
  if (!name || name.length > 38) return "Company code must be 1–38 characters (it becomes the database name)";
  if (/[\/\\. "$*<>:|?]/.test(name)) return "Company code can only use letters, numbers, - and _ (it becomes the database name)";
  if (RESERVED.has(name.toLowerCase())) return `"${name}" is reserved by MongoDB — pick another company code`;
  if (name.toLowerCase() === String(process.env.MONGODB_DB || "leadhive").toLowerCase()) return "That code is the platform database name — pick another company code";
  return null;
}

/** Which database holds a company's data right now (null = still in the main database, i.e. not migrated yet). */
const dbMemo = new Map<string, { v: string | null; exp: number }>();
export async function dbOf(companyId: any): Promise<string | null> {
  if (!companyId) return null;
  const k = String(companyId);
  const hit = dbMemo.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  const c = await Company.findById(companyId).select("dbName dbReadyAt").lean<any>();
  const v = c?.dbReadyAt && c.dbName ? c.dbName : null;
  // a database never changes once set (cache 10 min); "not moved yet" is re-checked every 10 s
  dbMemo.set(k, { v, exp: Date.now() + (v ? 600_000 : 10_000) });
  if (dbMemo.size > 50_000) dbMemo.clear();
  return v;
}

/** Run `fn` against a company's database (resolves the db name, cached). */
export async function inCompanyDb<T>(companyId: any, fn: () => Promise<T>): Promise<T> {
  const db = await dbOf(companyId);
  return runInDb(db, fn);
}

/** Creates the database: every company collection + its indexes (MongoDB creates a database on first write). */
export async function provisionDb(dbName: string) {
  for (const { name } of TENANT_MODELS) {
    const M = tenantModelFor(name, dbName);
    await M.createCollection().catch((e: any) => {
      if (e?.codeName !== "NamespaceExists" && e?.code !== 48) throw e;
    });
    // one index at a time: a performance index the server can't build (e.g. text search on some MongoDB-compatible
    // services) must not block the company; unique indexes guarantee correctness, so those must succeed
    for (const [fields, options] of M.schema.indexes() as [any, any][]) {
      try {
        await M.collection.createIndex(fields, { background: true, ...options });
      } catch (e: any) {
        if (options?.unique) throw e;
        console.warn(`index ${JSON.stringify(fields)} on ${name}@${dbName} skipped: ${e?.message}`);
      }
    }
  }
}

const migrating = new Map<string, Promise<void>>();

/**
 * Moves a pre-existing company's data from the main database into its own database (idempotent, resumable):
 * copy (keeping _id) → verify → delete from main → mark ready. Runs once per company, on first use or from the Super Admin button.
 */
export function migrateCompany(companyId: string): Promise<void> {
  const key = String(companyId);
  if (!migrating.has(key)) migrating.set(key, doMigrate(key).finally(() => migrating.delete(key)));
  return migrating.get(key)!;
}

async function doMigrate(companyId: string) {
  const c = await Company.findById(companyId).lean<any>();
  if (!c || c.dbReadyAt) return;
  const dbName = c.dbName || dbNameFromCode(c.code);
  const err = validateDbName(dbName);
  if (err) throw new Error(`${c.name}: ${err}`);
  if (!c.dbName) await Company.updateOne({ _id: c._id }, { $set: { dbName } });
  await provisionDb(dbName);
  const cid = new mongoose.Types.ObjectId(companyId);
  for (const { name } of TENANT_MODELS) {
    const main = tenantModelFor(name, null).collection;
    const target = tenantModelFor(name, dbName).collection;
    const filter: any = { companyId: cid };
    if (["Webhook", "WaLog", "ActivityLog", "Role"].includes(name)) filter.scope = "company";
    for (;;) {
      const batch = await main.find(filter).limit(500).toArray();
      if (!batch.length) break;
      await target.insertMany(batch, { ordered: false }).catch((e: any) => {
        if (!(e?.code === 11000 || e?.writeErrors?.every((w: any) => w.code === 11000))) throw e; // already copied
      });
      const ids = batch.map((d) => d._id);
      const copied = await target.countDocuments({ _id: { $in: ids } });
      if (copied !== ids.length) throw new Error(`Copy check failed for ${name} (${copied}/${ids.length})`);
      await main.deleteMany({ _id: { $in: ids } });
    }
  }
  // global registry of public connector keys → company database
  const conns = await tenantModelFor("Connector", dbName).find({}).select("key type active").lean<any[]>();
  for (const k of conns) await ConnectorKey.updateOne({ key: k.key }, { $set: { companyId: cid, db: dbName, type: k.type, active: k.active } }, { upsert: true });
  await Company.updateOne({ _id: c._id }, { $set: { dbReadyAt: new Date() } });
  dbMemo.delete(String(companyId));
  await invalidate("tdb:all");
  await moveStragglers(cid, dbName); // anything written to the old location while we were copying
}

/** Moves company records that landed in the main database after the company moved (cache lag on other servers). */
async function moveStragglers(cid: mongoose.Types.ObjectId, dbName: string) {
  let moved = 0;
  for (const { name } of TENANT_MODELS) {
    const main = tenantModelFor(name, null).collection;
    const filter: any = { companyId: cid };
    if (["Webhook", "WaLog", "ActivityLog", "Role"].includes(name)) filter.scope = "company";
    const docs = await main.find(filter).limit(1000).toArray();
    if (!docs.length) continue;
    await tenantModelFor(name, dbName).collection.insertMany(docs, { ordered: false }).catch(() => undefined);
    const ids = docs.map((d) => d._id);
    if ((await tenantModelFor(name, dbName).collection.countDocuments({ _id: { $in: ids } })) === ids.length) {
      await main.deleteMany({ _id: { $in: ids } });
      moved += ids.length;
    }
  }
  return moved;
}

/** Periodic safety net (runs with the 15-minute retry job). */
export async function sweepStragglers() {
  const ready = await Company.find({ dbReadyAt: { $ne: null } }).select("dbName").lean<any[]>();
  if (!ready.length) return 0;
  const ids = ready.map((c) => c._id);
  const hit = new Set<string>();
  for (const { name } of TENANT_MODELS) for (const id of await tenantModelFor(name, null).collection.distinct("companyId", { companyId: { $in: ids } })) hit.add(String(id));
  let moved = 0;
  for (const c of ready.filter((x) => hit.has(String(x._id)))) moved += await moveStragglers(c._id, c.dbName);
  return moved;
}

/** Background pass for all companies still in the main database. */
export async function migrateAll() {
  const pending = await Company.find({ dbReadyAt: null }).select("_id name").lean<any[]>();
  const out: { company: string; ok: boolean; error?: string }[] = [];
  for (const c of pending) {
    try {
      await migrateCompany(String(c._id));
      out.push({ company: c.name, ok: true });
    } catch (e: any) {
      out.push({ company: c.name, ok: false, error: e?.message });
    }
  }
  return out;
}

/** Runs `fn` in every company database with bounded concurrency (Super Admin views across companies). */
export async function forEachCompanyDb<T>(fn: (c: { _id: any; name: string; code: string; db: string | null }) => Promise<T>, opts: { concurrency?: number; includeDeleted?: boolean } = {}) {
  const list = await cached(`tdb:all:${opts.includeDeleted ? 1 : 0}`, 60, () =>
    Company.find(opts.includeDeleted ? {} : { deletedAt: null }).select("name code dbName dbReadyAt").lean<any[]>()
  );
  const items = list.map((c) => ({ _id: c._id, name: c.name, code: c.code, db: c.dbReadyAt && c.dbName ? c.dbName : null }));
  const results: { company: (typeof items)[number]; value: T }[] = [];
  const conc = Math.max(1, opts.concurrency || 8);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(conc, items.length) }, async () => {
      while (i < items.length) {
        const c = items[i++];
        results.push({ company: c, value: await runInDb(c.db, () => fn(c)) });
      }
    })
  );
  return results;
}

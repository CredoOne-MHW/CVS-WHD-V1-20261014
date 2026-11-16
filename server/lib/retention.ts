/**
 * Retention Policy (Super Admin › Company › Retention Policy).
 *
 * Every log the platform keeps is listed in LOG_KINDS, with a default period. A company may shorten or lengthen
 * each one; "Keep for ever" (0) switches deletion off. The nightly housekeeping job — and the Apply button on the
 * tab — delete records older than the period, oldest first, in bounded batches so a huge collection never blocks
 * a request.
 *
 * A floor (`minDays`) protects the logs an audit may need: activity and WhatsApp history can be shortened, but
 * not below the floor, and the tab says so.
 */
import mongoose from "mongoose";
import { Company } from "../models";
import { currentDb } from "./context";
import { inCompanyDb } from "./tenantdb";
import { LOG_KINDS, type LogKindDef } from "../../shared/platform";

const BATCH = 2000;

export function daysFor(def: LogKindDef, company: any) {
  const raw = company?.retention?.[def.key];
  const d = raw === undefined || raw === null ? def.defaultDays : Number(raw);
  if (d === 0) return 0; // keep for ever
  return def.minDays ? Math.max(def.minDays, d) : d;
}

/** The collection a kind lives in, in whichever database it belongs to. */
function coll(def: LogKindDef) {
  const conn = def.where === "tenant" ? mongoose.connection.useDb(currentDb() || mongoose.connection.name, { useCache: true }) : mongoose.connection;
  return conn.collection(def.collection);
}

/** Counts and the oldest record, for the tab. */
export async function retentionRows(company: any) {
  return inCompanyDb(String(company._id), async () => {
    const rows = [];
    for (const def of LOG_KINDS) {
      let records = 0;
      let oldest: Date | null = null;
      try {
        const c = coll(def);
        records = await c.countDocuments({}, { maxTimeMS: 4000 });
        const first = await c.find({}, { projection: { createdAt: 1, startedAt: 1 }, sort: { _id: 1 }, limit: 1 }).toArray();
        oldest = (first[0]?.createdAt || first[0]?.startedAt || null) as Date | null;
      } catch {
        /* a collection that does not exist yet simply has no records */
      }
      const days = daysFor(def, company);
      rows.push({ ...def, days, custom: company?.retention?.[def.key] !== undefined, records, oldest });
    }
    return rows;
  });
}

/** Delete what is past its period. `only` limits it to one kind (the row's Apply button). */
export async function applyRetention(company: any, only?: string) {
  return inCompanyDb(String(company._id), async () => {
    const out: Record<string, number> = {};
    for (const def of LOG_KINDS) {
      if (only && def.key !== only) continue;
      const days = daysFor(def, company);
      if (!days) continue; // keep for ever
      const cutoff = new Date(Date.now() - days * 86400_000);
      let removed = 0;
      try {
        const c = coll(def);
        for (let i = 0; i < 25; i++) {
          // bounded batches: ids first, then one delete — portable across engines that lack $expr deletes
          const ids = (await c.find({ $or: [{ createdAt: { $lt: cutoff } }, { startedAt: { $lt: cutoff } }] }, { projection: { _id: 1 }, limit: BATCH }).toArray()).map((d: any) => d._id);
          if (!ids.length) break;
          const r = await c.deleteMany({ _id: { $in: ids } });
          removed += r.deletedCount || 0;
          if (ids.length < BATCH) break;
        }
      } catch {
        /* skip a collection this company does not have */
      }
      out[def.key] = removed;
    }
    return out;
  });
}

/** Save the company's periods (only what differs from the default is kept). */
export async function saveRetention(companyId: any, retention: Record<string, any>) {
  const clean: Record<string, number> = {};
  for (const def of LOG_KINDS) {
    const v = retention?.[def.key];
    if (v === undefined || v === null || v === "") continue;
    const d = Math.max(0, Number(v) || 0);
    if (d !== def.defaultDays) clean[def.key] = d === 0 ? 0 : def.minDays ? Math.max(def.minDays, d) : d;
  }
  await Company.updateOne({ _id: companyId }, { $set: { retention: clean } });
  return clean;
}

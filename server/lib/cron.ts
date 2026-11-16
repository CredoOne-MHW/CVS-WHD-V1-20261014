/**
 * Per-company control of the platform's background jobs (Super Admin › Company › Cron Jobs).
 *
 * Vercel fires each /api/cron/… route on the fixed schedule in vercel.json. That stays the heartbeat; what a
 * company's own setting decides is whether this company's share of the work runs on this beat, and how often:
 *
 *   gate(job, company)  → false when the job is switched off for the company, or its interval has not elapsed
 *   record(...)         → writes the CronRun entry the tab reads (last run, duration, result)
 *   runFor(job, co, fn) → the two together, so a cron route is one line per company
 *
 * A job the company has not touched follows the platform default in CRON_JOBS, so nothing changes until
 * someone edits it.
 */
import { CronRun, Company } from "../models";
import { CRON_JOBS, cronJob, cronOf, cronDue, type CronJobDef } from "../../shared/platform";

export type CronWho = "cron" | string;

/** The company's effective setting for a job. */
export function settingOf(def: CronJobDef, company: any) {
  return cronOf(def, company?.cron?.[def.key]);
}

/** Last run of a job (for a company, or platform-wide when companyId is null). */
export async function lastRun(job: string, companyId: any = null) {
  return CronRun.findOne({ job, companyId: companyId || null }).sort({ startedAt: -1 }).lean<any>();
}

/** May this job do this company's work now? */
export async function gate(job: string, company: any, now = new Date()) {
  const def = cronJob(job);
  if (!def) return false;
  const s = settingOf(def, company);
  if (!s.on) return false;
  const last = await lastRun(job, def.perCompany ? company?._id : null);
  return cronDue(s, last?.startedAt, now);
}

export async function record(job: string, companyId: any, startedAt: Date, ok: boolean, result?: any, error?: string, by: CronWho = "cron") {
  await CronRun.create({ job, companyId: companyId || null, startedAt, ms: Date.now() - startedAt.getTime(), ok, result, error: error?.slice(0, 300), by }).catch(() => {});
}

/**
 * Run a job's work for one company, honouring its schedule and writing the run entry.
 * `force` is Run now from the tab. Returns null when the gate said no.
 */
export async function runFor<T>(job: string, company: any, fn: () => Promise<T>, opts: { force?: boolean; by?: CronWho } = {}): Promise<T | null> {
  if (!opts.force && !(await gate(job, company))) return null;
  const startedAt = new Date();
  try {
    const result = await fn();
    await record(job, company?._id, startedAt, true, result, undefined, opts.by || "cron");
    return result;
  } catch (e: any) {
    await record(job, company?._id, startedAt, false, undefined, e?.message || String(e), opts.by || "cron");
    throw e;
  }
}

/** The same for a platform-wide job (no company). */
export const runPlatform = <T>(job: string, fn: () => Promise<T>, opts: { force?: boolean; by?: CronWho } = {}) => runFor(job, null, fn, opts);

/** Rows for the Cron Jobs tab: every job, this company's schedule, its last and next run. */
export async function jobRows(company: any) {
  const runs = await CronRun.aggregate([
    { $match: { companyId: company?._id ? company._id : null } },
    { $sort: { startedAt: -1 } },
    { $group: { _id: "$job", startedAt: { $first: "$startedAt" }, ms: { $first: "$ms" }, ok: { $first: "$ok" }, result: { $first: "$result" }, error: { $first: "$error" } } },
  ]).catch(() => [] as any[]);
  const byJob = new Map<string, any>(runs.map((r: any) => [r._id, r]));
  // platform-wide jobs log against no company
  const shared = await CronRun.find({ companyId: null }).sort({ startedAt: -1 }).limit(200).lean<any[]>().catch(() => []);
  for (const r of shared) if (!byJob.has(r.job)) byJob.set(r.job, r);

  const now = new Date();
  return CRON_JOBS.map((def) => {
    const s = settingOf(def, company);
    const last = byJob.get(def.key);
    let next: Date | null = null;
    if (s.on) {
      if (s.unit === "daily") {
        const [h, m] = s.at.split(":").map(Number);
        const ist = new Date(now.getTime() + 5.5 * 3600_000);
        let t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m) - 5.5 * 3600_000;
        if (t <= now.getTime()) t += 86400_000;
        next = new Date(t);
      } else {
        const ms = Math.max(1, s.every) * (s.unit === "hours" ? 3600_000 : 60_000);
        next = new Date((last?.startedAt ? new Date(last.startedAt).getTime() : now.getTime()) + ms);
        if (next < now) next = now;
      }
    }
    return { ...def, setting: s, custom: !!company?.cron?.[def.key], last: last ? { at: last.startedAt, ms: last.ms, ok: last.ok, result: last.result, error: last.error } : null, next };
  });
}

/** Save the company's overrides (only the keys that differ from the default are kept). */
export async function saveCron(companyId: any, cron: Record<string, any>) {
  const clean: Record<string, any> = {};
  for (const def of CRON_JOBS) {
    const o = cron?.[def.key];
    if (!o) continue;
    const s = cronOf(def, o);
    const sameAsDefault = s.on && s.unit === def.unit && (def.unit === "daily" ? s.at === (def.at || "02:00") : s.every === (def.every ?? 1));
    if (!sameAsDefault) clean[def.key] = { on: s.on, unit: s.unit, every: s.every, at: s.at };
  }
  await Company.updateOne({ _id: companyId }, { $set: { cron: clean } });
  return clean;
}

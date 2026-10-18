/**
 * Background jobs — bulk imports, exports, WhatsApp redelivery, scheduled AI digests.
 *
 * Durable queue in the main database (Job model):
 *   • enqueue() is idempotent by idemKey (the same key never creates a second job);
 *   • a worker claims one job atomically (findOneAndUpdate on status + lockedUntil), so two instances never run the same job;
 *   • handlers work in time-boxed SLICES and return a cursor — long jobs survive the 60 s serverless limit and resume on
 *     any instance (slices that make progress don't count as failures);
 *   • a failing slice is retried with exponential backoff + jitter; after maxAttempts the job is dead-lettered (status
 *     "dead") and visible in Super Admin › System Health, where it can be replayed;
 *   • the worker runs every minute from Vercel Cron (/api/cron/jobs), and also a slice at a time whenever someone polls a
 *     job's progress — so a job never waits for the cron when a user is watching it.
 */
import mongoose from "mongoose";
import { Job } from "../models";
import { runInDb } from "./context";
import { dbOf } from "./tenantdb";

export interface JobCtx {
  job: any;
  /** ms left in this slice — stop and return { done: false, state } before it runs out */
  timeLeft: () => number;
  progress: (done: number, total?: number) => Promise<void>;
}
export type SliceResult = { done: true; result?: any } | { done: false; state: any };
type Handler = (payload: any, state: any, ctx: JobCtx) => Promise<SliceResult>;

const handlers = new Map<string, { run: Handler; maxAttempts: number }>();

export function defineJob(type: string, run: Handler, opts: { maxAttempts?: number } = {}) {
  handlers.set(type, { run, maxAttempts: opts.maxAttempts ?? 6 });
}

/** 30 s, 2 min, 8 min, 32 min, 2 h, 6 h … (±20 % jitter so retries don't stampede a recovering provider) */
export function backoffMs(attempt: number) {
  const base = Math.min(6 * 3600_000, 30_000 * 4 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export async function enqueue(type: string, payload: any, opts: { companyId?: any; idemKey?: string; runAt?: Date; createdBy?: string; maxAttempts?: number } = {}) {
  const db = opts.companyId ? await dbOf(opts.companyId) : null;
  const doc = {
    type,
    payload,
    companyId: opts.companyId ? new mongoose.Types.ObjectId(String(opts.companyId)) : undefined,
    db,
    status: "queued",
    runAt: opts.runAt || new Date(),
    maxAttempts: opts.maxAttempts ?? handlers.get(type)?.maxAttempts ?? 6,
    createdBy: opts.createdBy,
  };
  if (!opts.idemKey) return Job.create(doc);
  try {
    return await Job.findOneAndUpdate({ idemKey: opts.idemKey }, { $setOnInsert: { ...doc, idemKey: opts.idemKey } }, { upsert: true, new: true }).lean();
  } catch (e: any) {
    if (e?.code === 11000) return Job.findOne({ idemKey: opts.idemKey }).lean(); // lost the race — same job
    throw e;
  }
}

const LOCK_MS = 75_000;

async function claim(filter: any = {}) {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      ...filter,
      $or: [
        { status: { $in: ["queued", "failed"] }, runAt: { $lte: now } },
        { status: "running", lockedUntil: { $lt: now } }, // a worker died mid-slice
      ],
    },
    { $set: { status: "running", lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { slices: 1 } },
    { sort: { runAt: 1 }, new: true }
  ).lean<any>();
}

async function runOne(job: any, sliceMs: number) {
  const h = handlers.get(job.type);
  if (!h) {
    await Job.updateOne({ _id: job._id }, { $set: { status: "dead", error: `Unknown job type "${job.type}"`, finishedAt: new Date(), lockedUntil: null } });
    return;
  }
  if ((job.slices || 0) > 2000) {
    await Job.updateOne({ _id: job._id }, { $set: { status: "dead", error: "Too many slices — stopped", finishedAt: new Date(), lockedUntil: null } });
    return;
  }
  const end = Date.now() + sliceMs;
  const ctx: JobCtx = {
    job,
    timeLeft: () => end - Date.now(),
    progress: async (done, total) => {
      await Job.updateOne({ _id: job._id }, { $set: { "progress.done": done, ...(total != null ? { "progress.total": total } : {}), lockedUntil: new Date(Date.now() + LOCK_MS) } });
    },
  };
  try {
    const r = await runInDb(job.db || null, () => h.run(job.payload, job.state, ctx));
    if (r.done) await Job.updateOne({ _id: job._id }, { $set: { status: "done", result: r.result ?? null, error: null, finishedAt: new Date(), lockedUntil: null } });
    else await Job.updateOne({ _id: job._id }, { $set: { status: "queued", state: r.state, runAt: new Date(), lockedUntil: null } });
  } catch (e: any) {
    const attempts = (job.attempts || 0) + 1;
    const dead = attempts >= (job.maxAttempts || 6);
    await Job.updateOne(
      { _id: job._id },
      { $set: { status: dead ? "dead" : "failed", attempts, error: String(e?.message || e).slice(0, 1000), runAt: new Date(Date.now() + backoffMs(attempts)), lockedUntil: null, ...(dead ? { finishedAt: new Date() } : {}) } }
    );
  }
}

/** Run jobs until the time budget is used. Pass jobId to advance one job only (progress polling). */
export async function pump(opts: { budgetMs: number; jobId?: any; sliceMs?: number }) {
  const until = Date.now() + opts.budgetMs;
  let ran = 0;
  while (Date.now() < until - 1500) {
    const job = await claim(opts.jobId ? { _id: opts.jobId } : {});
    if (!job) break;
    await runOne(job, Math.min(opts.sliceMs ?? 25_000, until - Date.now()));
    ran++;
    if (opts.jobId) {
      const j = await Job.findById(opts.jobId).select("status runAt").lean<any>();
      if (!j || j.status !== "queued" || new Date(j.runAt) > new Date()) break;
    }
  }
  return ran;
}

/** Public shape of a job for the UI. */
export const jobView = (j: any) =>
  j && {
    _id: j._id,
    type: j.type,
    status: j.status,
    progress: j.progress,
    attempts: j.attempts,
    error: j.status === "done" ? undefined : j.error,
    result: j.result,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    nextAttemptAt: j.status === "failed" ? j.runAt : undefined,
  };

/* ───────────── File storage for job output (GridFS in the company's own database) ───────────── */
function bucket(db: string | null) {
  const conn = db ? mongoose.connection.useDb(db, { useCache: true }) : mongoose.connection;
  return new mongoose.mongo.GridFSBucket(conn.db!, { bucketName: "jobfiles" });
}
export async function saveFile(db: string | null, name: string, data: Buffer, contentType: string) {
  const b = bucket(db);
  const up = b.openUploadStream(name, { metadata: { contentType, at: new Date() } });
  await new Promise<void>((resolve, reject) => up.end(data, (err?: any) => (err ? reject(err) : resolve())));
  return String(up.id);
}
export function readFile(db: string | null, id: string) {
  return bucket(db).openDownloadStream(new mongoose.Types.ObjectId(id));
}
export async function deleteFile(db: string | null, id: string) {
  await bucket(db).delete(new mongoose.Types.ObjectId(id)).catch(() => undefined);
}

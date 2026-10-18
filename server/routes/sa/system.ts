/**
 * Super Admin › System Health: API latency vs budget (p50 / p95 per route, last 24 h), background jobs (queued,
 * running, retrying, dead-lettered — replayable), and external providers' circuit breakers.
 */
import { Router } from "express";
import mongoose from "mongoose";
import { Job, PerfStat, ProviderState, Company } from "../../models";
import { can } from "../../middleware/auth";
import { h, notFound } from "../../lib/http";
import { flushMetrics } from "../../lib/metrics";
import { pump, jobView } from "../../lib/jobs";
import { BUCKETS, percentile, READ_BUDGET_MS, WRITE_BUDGET_MS } from "../../../shared/perf";

const r = Router();

/** Routes that wait on something outside our control (AI models, provider calls, file processing) have no budget. */
const EXTERNAL = /\/(assistant|chat|ai-agents\/[^/]+\/chat|ai\/v1|agentic|insights|share|jobs|test|run|import|export|reminder|check|wa-post|intake|rotate|mcp)/;

r.get("/system/health", can("system", "read"), h(async (req, res) => {
  await flushMetrics(true);
  const hours = Math.min(168, Number(req.query.hours) || 24);
  const since = new Date(Date.now() - hours * 3600_000);
  const stats = await PerfStat.find({ hour: { $gte: since } }).lean<any[]>();
  const by = new Map<string, any>();
  for (const s of stats) {
    const k = `${s.method} ${s.route}`;
    const a = by.get(k) || { method: s.method, route: s.route, count: 0, errors: 0, sum: 0, max: 0, b: new Array(BUCKETS.length).fill(0) };
    a.count += s.count;
    a.errors += s.errors;
    a.sum += s.sum;
    a.max = Math.max(a.max, s.max);
    for (const [i, n] of Object.entries(s.b || {})) a.b[Number(i)] += n as number;
    by.set(k, a);
  }
  const routes = [...by.values()]
    .map((a) => {
      const write = a.method !== "GET";
      const external = EXTERNAL.test(a.route);
      const budget = external ? null : write ? WRITE_BUDGET_MS : READ_BUDGET_MS;
      const p95 = percentile(a.b, 0.95, a.max);
      return { method: a.method, route: a.route, count: a.count, errors: a.errors, avg: Math.round(a.sum / a.count), p50: percentile(a.b, 0.5, a.max), p95, max: Math.round(a.max), budget, ok: budget == null ? null : p95 <= budget, kind: external ? "external" : write ? "write" : "read" };
    })
    .sort((x, y) => (x.ok === false ? -1 : 0) - (y.ok === false ? -1 : 0) || y.count - x.count);

  const overall = (kind: "read" | "write") => {
    const b = new Array(BUCKETS.length).fill(0);
    let n = 0;
    let max = 0;
    for (const [k, a] of by) {
      if (EXTERNAL.test(a.route) || (kind === "read") !== (a.method === "GET")) continue;
      a.b.forEach((x: number, i: number) => (b[i] += x));
      n += a.count;
      max = Math.max(max, a.max);
      void k;
    }
    const p95 = percentile(b, 0.95, max);
    return { count: n, p50: percentile(b, 0.5, max), p95, budget: kind === "read" ? READ_BUDGET_MS : WRITE_BUDGET_MS, ok: !n || p95 <= (kind === "read" ? READ_BUDGET_MS : WRITE_BUDGET_MS) };
  };

  const [byStatus, byType, problems, providers] = await Promise.all([
    Job.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Job.aggregate([{ $match: { createdAt: { $gte: new Date(Date.now() - 7 * 86400_000) } } }, { $group: { _id: { type: "$type", status: "$status" }, n: { $sum: 1 } } }]),
    Job.find({ status: { $in: ["failed", "dead"] } }).sort({ updatedAt: -1, _id: -1 }).limit(50).lean<any[]>(),
    ProviderState.find().sort({ lastFailureAt: -1 }).limit(30).lean<any[]>(),
  ]);
  const names = new Map((await Company.find({ _id: { $in: problems.map((j) => j.companyId).filter(Boolean) } }).select("name").lean<any[]>()).map((c) => [String(c._id), c.name]));
  res.json({
    hours,
    budgets: { read: READ_BUDGET_MS, write: WRITE_BUDGET_MS },
    overall: { read: overall("read"), write: overall("write") },
    routes,
    jobs: {
      byStatus: Object.fromEntries(byStatus.map((x: any) => [x._id, x.n])),
      byType: byType.map((x: any) => ({ type: x._id.type, status: x._id.status, n: x.n })),
      problems: problems.map((j) => ({ ...jobView(j), company: j.companyId ? names.get(String(j.companyId)) || "—" : "Platform", payload: j.type === "wa.redeliver" ? j.payload : undefined })),
    },
    providers: providers.map((p) => ({ host: p._id, failures: p.failures, open: p.openUntil && new Date(p.openUntil) > new Date(), openUntil: p.openUntil, lastError: p.lastError, lastFailureAt: p.lastFailureAt, lastSuccessAt: p.lastSuccessAt })),
  });
}));

/** Replay a dead-lettered (or waiting) job now, with a fresh set of attempts. */
r.post("/system/jobs/:id/retry", can("system", "update"), h(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
  const j = await Job.findOneAndUpdate({ _id: req.params.id, status: { $in: ["dead", "failed"] } }, { $set: { status: "queued", runAt: new Date(), attempts: 0, lockedUntil: null, finishedAt: null } }, { new: true }).lean<any>();
  if (!j) throw notFound();
  await pump({ budgetMs: 8_000, jobId: j._id, sliceMs: 7_000 });
  res.locals.action = "Replay job";
  res.locals.item = `${(j as any).type} ${req.params.id}`;
  res.json(jobView(await Job.findById(j._id).lean()));
}));

/** Close a provider's circuit by hand (e.g. after the provider confirms it is back). */
r.post("/system/providers/:host/reset", can("system", "update"), h(async (req, res) => {
  await ProviderState.updateOne({ _id: req.params.host }, { $set: { failures: 0, openUntil: null } });
  res.locals.action = "Reset circuit";
  res.locals.item = req.params.host;
  res.json({ ok: true });
}));

export default r;

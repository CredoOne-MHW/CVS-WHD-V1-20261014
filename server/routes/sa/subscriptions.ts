import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { AiAgent, AiAllocation, AiUsage, Company, Plan, Subscription, SubscriptionCycle, SubscriptionPlan, Webhook } from "../../models";
import { can } from "../../middleware/auth";
import { h, parse, notFound, badRequest, paging, escapeRegex } from "../../lib/http";
import { cached, invalidate } from "../../lib/cache";
import { FREQ_KEYS, freqLabel, discountOf, DAY, EXPIRE_AFTER_DAYS } from "../../../shared/billing";
import { inCompanyDb } from "../../lib/tenantdb";
import { ensureCycles, enrichCycles, notifyCycle, refreshIfStale, refreshStatuses, aiAmountFor } from "../../lib/billing";

/** Super Admin › Settings › Subscription Management. Every route needs the `subscriptions` permission. */
const r = Router();
const ID = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

/** Dropdown data for the pop-ups (cached 60 s; small). */
r.get("/meta", can("subscriptions", "read"), h(async (_req, res) => {
  res.json(
    await cached("billing:meta", 60, async () => {
      const [plans, companies, webhooks] = await Promise.all([
        Plan.find().select("name").sort({ name: 1 }).lean<any[]>(),
        Company.find({ deletedAt: null }).select("name code plan dbName").sort({ name: 1 }).lean<any[]>(),
        Webhook.find({ scope: "super", active: true }).select("name event").sort({ name: 1 }).lean<any[]>(),
      ]);
      return { plans: plans.map((p) => p.name), companies, webhooks };
    })
  );
}));

/* ───────────── Plan tab ───────────── */
const planBody = z.object({
  planName: z.string().min(1).max(60),
  amount: z.coerce.number().min(0).max(100_000_000),
  frequency: z.enum(FREQ_KEYS),
  reminderDays: z.array(z.coerce.number().int().refine((d) => [1, 3, 7].includes(d), "1, 3 or 7")).max(3).default([]),
  notifyWebApp: z.boolean().default(true),
  notifyWhatsApp: z.boolean().default(true),
  webhookId: ID.nullish().or(z.literal("")).transform((v) => v || null),
  active: z.boolean().default(true),
});

r.get("/plans", can("subscriptions", "read"), h(async (_req, res) => {
  const [plans, used] = await Promise.all([
    SubscriptionPlan.find().sort({ createdAt: -1 }).lean<any[]>(),
    Subscription.aggregate([{ $match: { active: true } }, { $group: { _id: "$subscriptionPlanId", n: { $sum: 1 } } }]),
  ]);
  const hooks = await Webhook.find({ _id: { $in: plans.map((p) => p.webhookId).filter(Boolean) } }).select("name").lean<any[]>();
  res.json(plans.map((p) => ({ ...p, companies: used.find((u: any) => String(u._id) === String(p._id))?.n || 0, webhookName: hooks.find((w) => String(w._id) === String(p.webhookId))?.name })));
}));

r.post("/plans", can("subscriptions", "create"), h(async (req, res) => {
  const b = parse(planBody, req.body);
  if (!(await Plan.exists({ name: b.planName }))) throw badRequest("Pick a plan from the Plan module");
  const doc = await SubscriptionPlan.create(b);
  await invalidate("billing:");
  res.locals.item = `${b.planName} · ${freqLabel(b.frequency)}`;
  res.status(201).json(doc);
}));

r.put("/plans/:id", can("subscriptions", "update"), h(async (req, res) => {
  const b = parse(planBody.partial(), req.body);
  if (b.planName && !(await Plan.exists({ name: b.planName }))) throw badRequest("Pick a plan from the Plan module");
  const doc = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { $set: b }, { new: true });
  if (!doc) throw notFound();
  // price / frequency changes apply to future cycles of companies on this plan
  if (b.amount != null || b.frequency || b.planName) await Subscription.updateMany({ subscriptionPlanId: doc._id, active: true }, { $set: { amount: doc.amount, frequency: doc.frequency, planName: doc.planName } });
  await invalidate("billing:");
  res.locals.item = `${doc.planName} · ${freqLabel(doc.frequency)}`;
  res.json(doc);
}));

r.delete("/plans/:id", can("subscriptions", "delete"), h(async (req, res) => {
  if (await Subscription.exists({ subscriptionPlanId: req.params.id, active: true })) throw badRequest("Companies are subscribed to this plan — end those subscriptions first (Allocation tab)");
  const d = await SubscriptionPlan.findByIdAndDelete(req.params.id);
  if (!d) throw notFound();
  await invalidate("billing:");
  res.locals.item = `${d.planName} · ${freqLabel(d.frequency)}`;
  res.json({ ok: true });
}));

/* ───────────── Allocation tab (company ↔ subscription plan) ───────────── */
const allocBody = z.object({
  companyId: ID,
  subscriptionPlanId: ID,
  startDate: z.coerce.date(),
  discountType: z.enum(["flat", "percent"]).default("flat"),
  discountValue: z.coerce.number().min(0).max(100_000_000).default(0),
});

r.get("/allocations", can("subscriptions", "read"), h(async (req, res) => {
  const q: any = {};
  if (req.query.active !== "all") q.active = true;
  if (typeof req.query.companyId === "string" && /^[a-f0-9]{24}$/.test(req.query.companyId)) q.companyId = req.query.companyId;
  const { page, limit, skip } = paging(req.query);
  const [items, total] = await Promise.all([Subscription.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<any[]>(), Subscription.countDocuments(q)]);
  const [cos, current] = await Promise.all([
    Company.find({ _id: { $in: items.map((x) => x.companyId) } }).select("name code").lean<any[]>(),
    // latest cycle per subscription: one indexed lookup each (≤ page size), no collection-wide aggregation
    Promise.all(items.map((s) => SubscriptionCycle.findOne({ subscriptionId: s._id }).sort({ periodStart: -1 }).select("subscriptionId periodEnd status").lean<any>())).then((l) => l.filter(Boolean).map((c: any) => ({ _id: c.subscriptionId, periodEnd: c.periodEnd, status: c.status }))),
  ]);
  res.json({
    items: items.map((s) => {
      const cur = current.find((c: any) => String(c._id) === String(s._id));
      return { ...s, company: cos.find((c) => String(c._id) === String(s.companyId)), discount: round2(discountOf(s.amount, s.discountType, s.discountValue)), nextDue: cur?.periodEnd, currentStatus: cur?.status };
    }),
    page,
    limit,
    total,
  });
}));

r.post("/allocations", can("subscriptions", "create"), h(async (req, res) => {
  const b = parse(allocBody, req.body);
  const [company, plan] = await Promise.all([Company.findOne({ _id: b.companyId, deletedAt: null }).select("name").lean<any>(), SubscriptionPlan.findOne({ _id: b.subscriptionPlanId, active: true }).lean<any>()]);
  if (!company) throw badRequest("Company not found");
  if (!plan) throw badRequest("Subscription plan not found or inactive");
  const dv = b.discountValue ?? 0;
  if (b.discountType === "percent" && dv > 100) throw badRequest("Percentage discount can't exceed 100");
  if (b.discountType === "flat" && dv > plan.amount) throw badRequest("Discount can't exceed the plan amount");
  // one active subscription per company: the previous one ends (its cycles and payment history stay)
  await Subscription.updateMany({ companyId: company._id, active: true }, { $set: { active: false } });
  const sub = await Subscription.create({ companyId: company._id, subscriptionPlanId: plan._id, planName: plan.planName, amount: plan.amount, frequency: plan.frequency, discountType: b.discountType, discountValue: b.discountValue, startDate: b.startDate, active: true, createdBy: req.auth!.email });
  await ensureCycles(sub.toObject());
  await invalidate("billing:");
  res.locals.action = "Allocate subscription";
  res.locals.item = `${company.name} → ${plan.planName} · ${freqLabel(plan.frequency)}`;
  res.status(201).json(sub);
}));

r.put("/allocations/:id", can("subscriptions", "update"), h(async (req, res) => {
  const b = parse(z.object({ discountType: z.enum(["flat", "percent"]).optional(), discountValue: z.coerce.number().min(0).max(100_000_000).optional(), active: z.boolean().optional() }), req.body);
  const sub = await Subscription.findByIdAndUpdate(req.params.id, { $set: b }, { new: true }).lean<any>();
  if (!sub) throw notFound();
  if (b.discountType || b.discountValue != null) {
    // re-price the unpaid current/future cycles with the new discount
    await SubscriptionCycle.updateMany({ subscriptionId: sub._id, status: "unpaid" }, { $set: { discount: round2(discountOf(sub.amount, sub.discountType, sub.discountValue)) } });
  }
  if (sub.active) await ensureCycles(sub);
  await invalidate("billing:");
  res.locals.item = `Subscription ${sub.planName}`;
  res.json(sub);
}));

r.delete("/allocations/:id", can("subscriptions", "delete"), h(async (req, res) => {
  const sub = await Subscription.findByIdAndUpdate(req.params.id, { $set: { active: false } }).lean<any>();
  if (!sub) throw notFound();
  await invalidate("billing:");
  res.locals.action = "End subscription";
  res.locals.item = sub.planName;
  res.json({ ok: true });
}));

/* ───────────── Status tab (billing cycles) ───────────── */
function cycleQuery(qs: any) {
  const now = new Date();
  const q: any = {};
  if (qs.tab === "overdue") q.status = "overdue";
  else if (qs.tab === "expired") q.status = "expired";
  else if (qs.tab === "paid") q.status = "paid";
  else {
    // Active = the current (or upcoming) cycle of each subscription, paid or not
    q.status = { $in: ["unpaid", "paid"] };
    q.periodEnd = { $gt: now };
  }
  if (typeof qs.companyId === "string" && /^[a-f0-9]{24}$/.test(qs.companyId)) q.companyId = new Types.ObjectId(qs.companyId);
  const from = qs.from ? new Date(String(qs.from)) : null;
  const to = qs.to ? new Date(String(qs.to)) : null;
  if ((from && !isNaN(+from)) || (to && !isNaN(+to))) {
    q.periodEnd = { ...(q.periodEnd || {}) };
    if (from && !isNaN(+from)) q.periodEnd.$gte = from;
    if (to && !isNaN(+to)) q.periodEnd.$lte = new Date(to.getTime() + DAY - 1); // inclusive end day
  }
  return q;
}

r.get("/cycles", can("subscriptions", "read"), h(async (req, res) => {
  await refreshIfStale(); // statuses stay correct even if the daily job hasn't run yet
  const q = cycleQuery(req.query);
  if (typeof req.query.company === "string" && req.query.company.trim()) {
    const ids = await Company.find({ name: { $regex: escapeRegex(req.query.company.trim()), $options: "i" } }).select("_id").limit(200).lean<any[]>();
    q.companyId = { $in: ids.map((x) => x._id) };
  }
  const { page, limit, skip } = paging(req.query);
  const [rows, total, counts] = await Promise.all([
    SubscriptionCycle.find(q).sort({ periodEnd: 1 }).skip(skip).limit(limit).lean<any[]>(),
    SubscriptionCycle.countDocuments(q),
    cached("billing:counts", 30, async () => {
      const now = new Date();
      const [active, overdue, expired] = await Promise.all([
        SubscriptionCycle.countDocuments({ status: { $in: ["unpaid", "paid"] }, periodEnd: { $gt: now } }),
        SubscriptionCycle.countDocuments({ status: "overdue" }),
        SubscriptionCycle.countDocuments({ status: "expired" }),
      ]);
      return { active, overdue, expired };
    }),
  ]);
  const cos = await Company.find({ _id: { $in: [...new Set(rows.map((x) => String(x.companyId)))] } }).select("name code whatsapp").lean<any[]>();
  const enriched = await enrichCycles(rows);
  res.json({
    items: enriched.map((c) => {
      const co = cos.find((x) => String(x._id) === String(c.companyId));
      return { ...c, company: co ? { _id: co._id, name: co.name, code: co.code, hasWhatsApp: !!co.whatsapp } : null };
    }),
    page,
    limit,
    total,
    counts,
  });
}));

r.put("/cycles/:id/status", can("subscriptions", "update"), h(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["paid", "unpaid", "overdue", "expired"]) }), req.body);
  const now = new Date();
  const set: any = { status, statusChangedAt: now, statusChangedBy: req.auth!.email, paidAt: status === "paid" ? now : null };
  const cy = await SubscriptionCycle.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean<any>();
  if (!cy) throw notFound();
  if (status === "paid" && cy.aiAmount == null && new Date(cy.periodEnd) <= now) await SubscriptionCycle.updateOne({ _id: cy._id }, { $set: { aiAmount: await aiAmountFor(cy.companyId, cy.periodStart, cy.periodEnd) } });
  if (status === "unpaid") await refreshStatuses(now); // "Unpaid" after the due date is shown as Over Due
  await invalidate("billing:");
  res.locals.action = `Payment status → ${status}`;
  res.locals.item = `${cy.planName} · due ${new Date(cy.periodEnd).toISOString().slice(0, 10)}`;
  res.json((await enrichCycles([await SubscriptionCycle.findById(cy._id).lean<any>()]))[0]);
}));

/** Usage pop-up: AI spend per model and per day in the cycle, credits and allocations, system amount. */
r.get("/cycles/:id/usage", can("subscriptions", "read"), h(async (req, res) => {
  const cy = await SubscriptionCycle.findById(req.params.id).lean<any>();
  if (!cy) throw notFound();
  const end = new Date(Math.min(Date.now(), new Date(cy.periodEnd).getTime()));
  const match = { companyId: new Types.ObjectId(String(cy.companyId)), createdAt: { $gte: new Date(cy.periodStart), $lt: end } };
  const [byModel, daily, allocs, company] = await Promise.all([
    inCompanyDb(cy.companyId, () => AiUsage.aggregate([{ $match: match }, { $group: { _id: "$agentId", calls: { $sum: 1 }, credits: { $sum: "$credits" }, billed: { $sum: "$billed" }, inTok: { $sum: "$inputTokens" }, outTok: { $sum: "$outputTokens" } } }, { $sort: { billed: -1 } }])),
    inCompanyDb(cy.companyId, () => AiUsage.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, billed: { $sum: "$billed" }, credits: { $sum: "$credits" } } }, { $sort: { _id: 1 } }]).catch(() => [])), // chart is optional
    AiAllocation.find({ companyId: cy.companyId, allocated: { $ne: false } }).lean<any[]>(),
    Company.findById(cy.companyId).select("name code").lean<any>(),
  ]);
  const models = await AiAgent.find({ _id: { $in: [...byModel.map((x: any) => x._id), ...allocs.map((a) => a.agentId)] } }).select("name llmVersion companyRate").lean<any[]>();
  const name = (id: any) => models.find((m) => String(m._id) === String(id));
  const [enriched] = await enrichCycles([cy]);
  res.json({
    cycle: enriched,
    company,
    byModel: byModel.map((x: any) => ({ model: name(x._id)?.name || "Removed model", llmVersion: name(x._id)?.llmVersion, calls: x.calls, credits: round2(x.credits), billed: round2(x.billed), tokens: (x.inTok || 0) + (x.outTok || 0) })),
    daily: daily.map((d: any) => ({ day: d._id, billed: round2(d.billed), credits: round2(d.credits) })),
    allocations: allocs.map((a) => ({ model: name(a.agentId)?.name, credits: a.credits, used: round2(a.used), remaining: round2(a.credits - a.used), frequency: a.frequency, renewalDate: a.renewalDate })),
  });
}));

/** Reminder action: send now through a chosen WhatsApp webhook (or every webhook on the subscription events). */
r.post("/cycles/:id/reminder", can("subscriptions", "update"), h(async (req, res) => {
  const b = parse(z.object({ webhookId: ID.nullish().or(z.literal("")), message: z.string().max(2000).optional() }), req.body);
  const cy = await SubscriptionCycle.findById(req.params.id).lean<any>();
  if (!cy) throw notFound();
  const [enriched] = await enrichCycles([cy]);
  const event = enriched.status === "expired" ? "subscription_expired" : enriched.status === "overdue" ? "subscription_overdue" : "subscription_reminder";
  const out: any = await notifyCycle({ ...cy, aiAmount: enriched.aiAmount, status: enriched.status }, event, { webhookId: b.webhookId || undefined, message: b.message || undefined, trigger: "manual", by: req.auth!.email });
  res.locals.action = "Subscription reminder";
  res.locals.item = `${cy.planName} · ${enriched.status}`;
  res.json({ sent: out.sent || 0, reason: out.reason });
}));

/** Overview numbers for the page header (cached 30 s). */
r.get("/summary", can("subscriptions", "read"), h(async (_req, res) => {
  res.json(
    await cached("billing:summary", 30, async () => {
      const agg = await SubscriptionCycle.aggregate([{ $group: { _id: "$status", n: { $sum: 1 }, sys: { $sum: "$systemAmount" }, disc: { $sum: "$discount" } } }]);
      const pick = (k: string) => {
        const x: any = agg.find((y: any) => y._id === k);
        return x ? { n: x.n, amount: round2(x.sys - x.disc) } : { n: 0, amount: 0 };
      };
      return { unpaid: pick("unpaid"), paid: pick("paid"), overdue: pick("overdue"), expired: pick("expired"), expireAfterDays: EXPIRE_AFTER_DAYS };
    })
  );
}));

export default r;

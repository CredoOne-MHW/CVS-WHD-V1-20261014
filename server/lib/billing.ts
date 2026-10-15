import { Types } from "mongoose";
import { AiAllocation, AiUsage, Company, Subscription, SubscriptionCycle, SubscriptionPlan, Webhook } from "../models";
import { addPeriod, nextRenewal, discountOf, effectiveStatus, EXPIRE_AFTER_DAYS, DAY } from "../../shared/billing";
import { cached, invalidate, rateLimit } from "./cache";
import { dispatch, fireEvent } from "./whatsapp";
import { runInMain } from "./context";
import { inCompanyDb } from "./tenantdb";

const oid = (v: any) => (v instanceof Types.ObjectId ? v : new Types.ObjectId(String(v)));
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const inr = (n: number) => `₹${round2(n).toLocaleString("en-IN")}`;

/* ───────────── AI model allocations: renew credits each cycle ───────────── */

/** Resets used credits and moves the renewal date on for every allocation whose renewal date has passed. */
export async function renewAllocations(now = new Date(), filter: Record<string, any> = {}) {
  const due = await AiAllocation.find({ ...filter, allocated: { $ne: false }, renewalDate: { $lte: now } }).select("frequency renewalDate").lean<any[]>();
  if (!due.length) return 0;
  await AiAllocation.bulkWrite(
    due.map((a) => ({
      updateOne: {
        filter: { _id: a._id, renewalDate: a.renewalDate }, // guard: another instance may have renewed it already
        update: { $set: { used: 0, exhaustedNotifiedAt: null, lastRenewedAt: now, renewalDate: nextRenewal(a.renewalDate, a.frequency || "monthly", now) } },
      },
    }))
  );
  await invalidate("billing:");
  return due.length;
}

/* ───────────── Subscription cycles ───────────── */

/** Live AI spend (₹, company rate) of a company in [start, end). */
export async function aiAmountFor(companyId: any, start: Date, end: Date) {
  const r = await inCompanyDb(companyId, () => AiUsage.aggregate([{ $match: { companyId: oid(companyId), createdAt: { $gte: new Date(start), $lt: new Date(end) } } }, { $group: { _id: null, billed: { $sum: "$billed" } } }]));
  return round2(r[0]?.billed || 0);
}

/** Creates any missing cycles for a subscription up to `now` (first cycle starts at startDate). Idempotent via unique index. */
export async function ensureCycles(sub: any, now = new Date()) {
  if (!sub.active) return 0;
  const last = await SubscriptionCycle.findOne({ subscriptionId: sub._id }).sort({ periodStart: -1 }).lean<any>();
  let start = last ? new Date(last.periodEnd) : new Date(sub.startDate);
  if (last && new Date(last.periodEnd) > now) return 0;
  let made = 0;
  // close the previous cycle's AI amount
  if (last && last.aiAmount == null) await SubscriptionCycle.updateOne({ _id: last._id }, { $set: { aiAmount: await aiAmountFor(sub.companyId, last.periodStart, last.periodEnd) } });
  for (let i = 0; i < 60; i++) {
    const end = addPeriod(start, sub.frequency);
    const discount = round2(discountOf(sub.amount, sub.discountType, sub.discountValue));
    await SubscriptionCycle.updateOne(
      { subscriptionId: sub._id, periodStart: start },
      { $setOnInsert: { companyId: sub.companyId, subscriptionId: sub._id, subscriptionPlanId: sub.subscriptionPlanId, planName: sub.planName, frequency: sub.frequency, periodStart: start, periodEnd: end, systemAmount: round2(sub.amount), discount, status: "unpaid" } },
      { upsert: true }
    );
    made++;
    if (end > now) break;
    // a cycle that already ended gets its AI amount snapshotted now
    await SubscriptionCycle.updateOne({ subscriptionId: sub._id, periodStart: start, aiAmount: null }, { $set: { aiAmount: await aiAmountFor(sub.companyId, start, end) } });
    start = end;
  }
  if (made) await invalidate("billing:");
  return made;
}

async function companyContact(companyId: any) {
  return cached(`billing:co:${companyId}`, 120, () => Company.findById(companyId).select("name whatsapp phone contactPerson").lean<any>());
}

/** Sends a subscription WhatsApp message through the plan's chosen webhook, or every active SA webhook for the event. */
export async function notifyCycle(cycle: any, event: "subscription_reminder" | "subscription_overdue" | "subscription_expired", opts: { webhookId?: any; message?: string; trigger?: "auto" | "manual"; by?: string } = {}) {
  const c = await companyContact(cycle.companyId);
  const phone = c?.whatsapp || c?.phone;
  if (!phone) return { sent: 0, reason: "Company has no WhatsApp number" };
  const total = round2((cycle.systemAmount || 0) - (cycle.discount || 0) + (cycle.aiAmount ?? 0));
  const due = fmtDate(cycle.periodEnd);
  const message =
    opts.message ||
    (event === "subscription_reminder"
      ? `Hi ${c.contactPerson || c.name}, your ${cycle.planName} subscription payment of ${inr(total)} is due on ${due}. Please pay to continue uninterrupted service.`
      : event === "subscription_overdue"
        ? `Hi ${c.contactPerson || c.name}, your ${cycle.planName} subscription payment of ${inr(total)} was due on ${due} and is now over due. Please pay at the earliest.`
        : `Hi ${c.contactPerson || c.name}, your ${cycle.planName} subscription has expired (payment due ${due} not received). Please contact us to renew.`);
  const ctx = { phone, name: c.contactPerson, company: c.name, message, params: { plan: cycle.planName, amount: total, due_date: due, status: cycle.status } };
  if (opts.webhookId) {
    const hook = await runInMain(() => Webhook.findOne({ _id: opts.webhookId, scope: "super", active: true }).lean());
    if (hook) {
      const results = await runInMain(() => dispatch(hook, ctx as any, { scope: "super", trigger: opts.trigger || "auto", triggeredBy: opts.by } as any));
      return { sent: results.filter((r: any) => r.ok).length, results };
    }
  }
  return fireEvent("super", undefined, event, ctx as any, opts.trigger || "auto", opts.by);
}

/** Unpaid past due → Over Due; Over Due 30 days past due → Expired. Notifies on each transition (once). */
export async function refreshStatuses(now = new Date()) {
  const toOverdue = await SubscriptionCycle.find({ status: "unpaid", periodEnd: { $lte: now } }).select("_id").lean<any[]>();
  if (toOverdue.length) await SubscriptionCycle.updateMany({ _id: { $in: toOverdue.map((x) => x._id) }, status: "unpaid" }, { $set: { status: "overdue", statusChangedAt: now, statusChangedBy: "system" } });
  const expireBefore = new Date(now.getTime() - EXPIRE_AFTER_DAYS * DAY);
  const toExpire = await SubscriptionCycle.find({ status: { $in: ["unpaid", "overdue"] }, periodEnd: { $lte: expireBefore } }).select("_id").lean<any[]>();
  if (toExpire.length) await SubscriptionCycle.updateMany({ _id: { $in: toExpire.map((x) => x._id) }, status: { $in: ["unpaid", "overdue"] } }, { $set: { status: "expired", statusChangedAt: now, statusChangedBy: "system" } });
  if (toOverdue.length || toExpire.length) await invalidate("billing:");
  return { overdue: toOverdue.length, expired: toExpire.length };
}

/** Cheap self-healing for screens: statuses and renewals are brought up to date at most every 5 minutes, even if the cron is late. */
export async function refreshIfStale() {
  if (!(await rateLimit("billing:refresh", 1, 300))) return;
  const now = new Date();
  await Promise.all([refreshStatuses(now), renewAllocations(now)]).catch((e) => console.warn("billing refresh:", e?.message));
}

/** Reminder (1/3/7 days prior, per plan), over-due and expired WhatsApp alerts. Each is sent once per cycle. */
export async function sendNotifications(now = new Date()) {
  let sent = 0;
  const plans = new Map((await SubscriptionPlan.find().lean<any[]>()).map((p) => [String(p._id), p]));
  // reminders for unpaid cycles due within the next 7 days
  const soon = await SubscriptionCycle.find({ status: "unpaid", periodEnd: { $gt: now, $lte: new Date(now.getTime() + 7 * DAY + DAY) } }).lean<any[]>();
  for (const cy of soon) {
    const plan = plans.get(String(cy.subscriptionPlanId));
    if (!plan?.notifyWhatsApp) continue;
    const daysLeft = Math.ceil((new Date(cy.periodEnd).getTime() - now.getTime()) / DAY);
    const hit = (plan.reminderDays || []).filter((d: number) => daysLeft <= d && !(cy.remindersSent || []).includes(d));
    if (!hit.length) continue;
    const claimed = await SubscriptionCycle.updateOne({ _id: cy._id, remindersSent: { $nin: hit } }, { $addToSet: { remindersSent: { $each: hit } } });
    if (!claimed.modifiedCount) continue; // another instance sent it
    const r: any = await notifyCycle({ ...cy, aiAmount: cy.aiAmount ?? (await aiAmountFor(cy.companyId, cy.periodStart, now)) }, "subscription_reminder", { webhookId: plan.webhookId });
    sent += r.sent || 0;
  }
  for (const [status, field, event] of [
    ["overdue", "overdueNotifiedAt", "subscription_overdue"],
    ["expired", "expiredNotifiedAt", "subscription_expired"],
  ] as const) {
    const list = await SubscriptionCycle.find({ status, [field]: null }).limit(500).lean<any[]>();
    for (const cy of list) {
      const claimed = await SubscriptionCycle.updateOne({ _id: cy._id, [field]: null }, { $set: { [field]: now } });
      if (!claimed.modifiedCount) continue;
      const plan = plans.get(String(cy.subscriptionPlanId));
      if (plan && !plan.notifyWhatsApp) continue;
      const r: any = await notifyCycle(cy, event, { webhookId: plan?.webhookId });
      sent += r.sent || 0;
    }
  }
  return sent;
}

/** Daily job (02:00 IST): renew AI allocations, roll subscription cycles, update statuses, send reminders. */
export async function runBillingJobs(now = new Date()) {
  const renewed = await renewAllocations(now);
  let cycles = 0;
  for (const sub of await Subscription.find({ active: true }).lean<any[]>()) cycles += await ensureCycles(sub, now);
  const statuses = await refreshStatuses(now);
  const notified = await sendNotifications(now);
  await invalidate("billing:");
  return { renewed, cycles, ...statuses, notified, at: now.toISOString() };
}

/* ───────────── Read models ───────────── */

/** Adds live AI amount, total and effective status to cycle rows (≤ 1 small indexed aggregation per open cycle). */
export async function enrichCycles(rows: any[], now = new Date()) {
  return Promise.all(
    rows.map(async (c) => {
      const ai = c.aiAmount ?? (await aiAmountFor(c.companyId, c.periodStart, new Date(Math.min(now.getTime(), new Date(c.periodEnd).getTime()))));
      const status = effectiveStatus(c.status, c.periodEnd, now);
      return { ...c, aiAmount: ai, aiLive: c.aiAmount == null, total: round2((c.systemAmount || 0) - (c.discount || 0) + ai), status, daysLeft: Math.ceil((new Date(c.periodEnd).getTime() - now.getTime()) / DAY) };
    })
  );
}

/**
 * What the company console needs on every page (for the top alert): cached 60 s per company and cleared on any billing change.
 * kind: overdue | expired | due_soon | null
 */
export async function billingAlert(companyId: string) {
  return cached(`billing:alert:${companyId}`, 60, async () => {
    const cy = await SubscriptionCycle.findOne({ companyId: oid(companyId), status: { $ne: "paid" } })
      .sort({ periodEnd: 1 })
      .select("planName periodEnd status systemAmount discount aiAmount subscriptionPlanId periodStart")
      .lean<any>();
    if (!cy) return null;
    const now = new Date();
    const status = effectiveStatus(cy.status, cy.periodEnd, now);
    const daysLeft = Math.ceil((new Date(cy.periodEnd).getTime() - now.getTime()) / DAY);
    let kind: string | null = status === "expired" ? "expired" : status === "overdue" ? "overdue" : null;
    if (!kind) {
      const plan = await SubscriptionPlan.findById(cy.subscriptionPlanId).select("reminderDays notifyWebApp").lean<any>();
      const window = Math.max(0, ...(plan?.reminderDays || []));
      if (plan?.notifyWebApp && daysLeft <= window) kind = "due_soon";
    }
    if (!kind) return null;
    const ai = cy.aiAmount ?? (await aiAmountFor(companyId, cy.periodStart, new Date(Math.min(now.getTime(), new Date(cy.periodEnd).getTime()))));
    return { kind, planName: cy.planName, dueDate: cy.periodEnd, daysLeft, amount: round2((cy.systemAmount || 0) - (cy.discount || 0) + ai) };
  });
}

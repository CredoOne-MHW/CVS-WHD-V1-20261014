/**
 * Company dashboard intelligence: one overview of the whole organisation (leads, pipeline, follow-ups, clients,
 * collections, support, WhatsApp delivery, AI credits, integrations), compared with the previous period of the same
 * length, turned into SIGNALS (what needs attention, what goes well) and a health score — plus AI recommendations.
 *
 * Every query is indexed and runs in parallel inside the company's own database. Aggregations that need operators some
 * Mongo-compatible engines lack fall back to small projected reads, so the dashboard never fails on them.
 */
import crypto from "crypto";
import mongoose from "mongoose";
import { Lead, WaLog, SupportTicket, ClientPayment, IntakeEvent, Connector, AiAllocation, AiAgent, CompanyAgent, Company } from "../models";
import { LOST_STATUS, WON_STATUS } from "../../shared/constants";
import { cached } from "./cache";
import { complete, parseJson } from "./ai";
import { withAgentDb } from "./agentic";
import { runInDb } from "./context";
import { dbOf, forEachCompanyDb } from "./tenantdb";
import { User, Webhook } from "../models";
import { defineJob, enqueue } from "./jobs";

const DAY = 86400_000;
const IST = "Asia/Kolkata";
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
const startOfTodayIST = () => new Date(`${istDay(new Date())}T00:00:00+05:30`);
const CLOSED = [WON_STATUS, LOST_STATUS];
const OPEN_TICKET = ["Open", "In Progress", "On Hold"];
const pctChange = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 100) : cur ? 100 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
export const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

async function countBy(model: mongoose.Model<any>, match: any, field: string): Promise<Record<string, number>> {
  const rows = await model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r: any) => [r._id ?? "—", r.n]));
}

/** Captured / converted per IST day, zero-filled. */
async function dailyTrend(cid: mongoose.Types.ObjectId, since: Date, days: number) {
  const match = { companyId: cid, deletedAt: null, createdAt: { $gte: since } };
  let rows: { d: string; n: number; won: number }[];
  try {
    rows = (
      await Lead.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: IST } }, n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ["$status", WON_STATUS] }, 1, 0] } } } },
      ])
    ).map((r: any) => ({ d: r._id, n: r.n, won: r.won }));
  } catch {
    // engines without $dateToString/$cond: bucket a projected read (createdAt + status only)
    const m = new Map<string, { n: number; won: number }>();
    for (const l of await Lead.find(match).select("createdAt status -_id").limit(50_000).lean<any[]>()) {
      const k = istDay(new Date(l.createdAt));
      const e = m.get(k) || { n: 0, won: 0 };
      e.n++;
      if (l.status === WON_STATUS) e.won++;
      m.set(k, e);
    }
    rows = [...m].map(([d, e]) => ({ d, ...e }));
  }
  const by = new Map(rows.map((r) => [r.d, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = istDay(new Date(Date.now() - i * DAY));
    out.push({ d, n: by.get(d)?.n || 0, won: by.get(d)?.won || 0 });
  }
  return out;
}

export async function overview(companyId: string, days: number) {
  const cid = new mongoose.Types.ObjectId(companyId);
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const prevSince = new Date(since.getTime() - days * DAY);
  const today = startOfTodayIST();
  const tomorrow = new Date(today.getTime() + DAY);
  const base = { companyId: cid, deletedAt: null };
  const inCur = { $gte: since, $lte: now };
  const inPrev = { $gte: prevSince, $lt: since };

  const [cur, prev, sourcesRaw, lostRaw, trend, openByStatus, uncontacted, oldestNew, overdueFU, dueTodayFU, dueList, todayN, clientsTotal, newClients, newClientsPrev, payments, tickets, ticketsClosed, wa, waRetry, intakeDead, connectors, allocs] = await Promise.all([
    countBy(Lead, { ...base, createdAt: inCur }, "status"),
    countBy(Lead, { ...base, createdAt: inPrev }, "status"),
    Lead.aggregate([{ $match: { ...base, createdAt: inCur } }, { $group: { _id: { s: "$source", st: "$status" }, n: { $sum: 1 } } }]),
    countBy(Lead, { ...base, status: LOST_STATUS, updatedAt: inCur }, "lostReason"),
    dailyTrend(cid, new Date(`${istDay(new Date(now.getTime() - (days - 1) * DAY))}T00:00:00+05:30`), days),
    countBy(Lead, { ...base, isClient: { $ne: true }, status: { $nin: CLOSED } }, "status"),
    Lead.countDocuments({ ...base, status: "New", createdAt: { $lt: new Date(now.getTime() - DAY) } }),
    Lead.findOne({ ...base, status: "New" }).sort({ createdAt: 1 }).select("createdAt").lean<any>(),
    Lead.countDocuments({ ...base, status: { $nin: CLOSED }, nextFollowUpAt: { $lt: today } }),
    Lead.countDocuments({ ...base, status: { $nin: CLOSED }, nextFollowUpAt: { $gte: today, $lt: tomorrow } }),
    Lead.find({ ...base, status: { $nin: CLOSED }, $or: [{ nextFollowUpAt: { $lt: tomorrow } }, { status: "Follow-ups needed" }] }).sort({ nextFollowUpAt: 1, _id: 1 }).limit(6).select("name phone whatsapp status nextFollowUpAt source").lean(),
    Lead.countDocuments({ ...base, createdAt: { $gte: today } }),
    Lead.countDocuments({ ...base, isClient: true }),
    Lead.countDocuments({ ...base, isClient: true, clientSince: inCur }),
    Lead.countDocuments({ ...base, isClient: true, clientSince: inPrev }),
    ClientPayment.find({ companyId: cid, $or: [{ status: { $ne: "paid" } }, { paidAt: { $gte: prevSince } }] }).select("status gross dueDate paidAt -_id").limit(20_000).lean<any[]>(),
    SupportTicket.find({ companyId: cid, status: { $in: OPEN_TICKET } }).select("category createdAt -_id").limit(5000).lean<any[]>(),
    SupportTicket.find({ companyId: cid, closedAt: inCur }).select("createdAt closedAt -_id").limit(5000).lean<any[]>(),
    countBy(WaLog, { companyId: cid, createdAt: inCur }, "result"),
    countBy(WaLog, { companyId: cid, createdAt: inCur, "retry.status": { $exists: true } }, "retry.status"),
    IntakeEvent.countDocuments({ companyId: cid, status: "dead", createdAt: inCur }),
    Connector.countDocuments({ companyId: cid, active: true }),
    AiAllocation.find({ companyId: cid, allocated: { $ne: false } }).select("agentId credits used").lean<any[]>(),
  ]);

  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const total = sum(cur);
  const totalPrev = sum(prev);
  const won = cur[WON_STATUS] || 0;
  const wonPrev = prev[WON_STATUS] || 0;
  const conv = total ? round1((won / total) * 100) : 0;
  const convPrev = totalPrev ? round1((wonPrev / totalPrev) * 100) : 0;

  // sources with conversion
  const srcMap = new Map<string, { n: number; won: number }>();
  for (const r of sourcesRaw) {
    const k = r._id?.s || "unknown";
    const e = srcMap.get(k) || { n: 0, won: 0 };
    e.n += r.n;
    if (r._id?.st === WON_STATUS) e.won += r.n;
    srcMap.set(k, e);
  }
  const sources = [...srcMap].map(([source, e]) => ({ source, n: e.n, won: e.won, conv: e.n ? round1((e.won / e.n) * 100) : 0 })).sort((a, b) => b.n - a.n);

  // money
  const paidIn = (from: Date, to: Date) => payments.filter((p) => p.status === "paid" && p.paidAt && new Date(p.paidAt) >= from && new Date(p.paidAt) <= to);
  const collected = paidIn(since, now).reduce((a, p) => a + (p.gross || 0), 0);
  const collectedPrev = paidIn(prevSince, since).reduce((a, p) => a + (p.gross || 0), 0);
  const overdueP = payments.filter((p) => p.status === "overdue" || (p.status === "unpaid" && new Date(p.dueDate) < today));
  const upcomingP = payments.filter((p) => p.status === "unpaid" && new Date(p.dueDate) >= today && new Date(p.dueDate) < new Date(today.getTime() + 7 * DAY));

  // support
  const stale = tickets.filter((t) => now.getTime() - new Date(t.createdAt).getTime() > 2 * DAY).length;
  const grievances = tickets.filter((t) => t.category === "Grievance").length;
  const resHours = ticketsClosed.length ? round1(ticketsClosed.reduce((a, t) => a + (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()), 0) / ticketsClosed.length / 3600_000) : null;

  // AI
  const agents = allocs.length ? await AiAgent.find({ _id: { $in: allocs.map((a) => a.agentId) } }).select("name").lean<any[]>() : [];
  const ai = allocs.map((a) => ({ model: agents.find((g) => String(g._id) === String(a.agentId))?.name || "AI model", credits: a.credits || 0, remaining: Math.max(0, (a.credits || 0) - (a.used || 0)) }));

  const waSent = sum(wa);
  const o = {
    days,
    generatedAt: now,
    leads: { total, totalPrev, change: pctChange(total, totalPrev), today: todayN, won, wonPrev, wonChange: pctChange(won, wonPrev), lost: cur[LOST_STATUS] || 0, conv, convPrev, convDelta: round1(conv - convPrev) },
    pipeline: { open: sum(openByStatus), byStatus: Object.entries(openByStatus).map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n) },
    speed: { uncontacted24h: uncontacted, newOpen: openByStatus["New"] || 0, oldestNewHours: oldestNew ? Math.round((now.getTime() - new Date(oldestNew.createdAt).getTime()) / 3600_000) : 0 },
    followups: { overdue: overdueFU, dueToday: dueTodayFU, list: dueList },
    sources,
    lostReasons: Object.entries(lostRaw).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    trend,
    clients: { total: clientsTotal, new: newClients, newPrev: newClientsPrev },
    money: { collected, collectedPrev, collectedChange: pctChange(collected, collectedPrev), overdue: overdueP.reduce((a, p) => a + (p.gross || 0), 0), overdueCount: overdueP.length, upcoming: upcomingP.reduce((a, p) => a + (p.gross || 0), 0), upcomingCount: upcomingP.length },
    support: { open: tickets.length, stale48h: stale, grievances, resolved: ticketsClosed.length, avgResolutionHours: resHours },
    whatsapp: { sent: waSent, success: wa.success || 0, failed: wa.failed || 0, successRate: waSent ? round1(((wa.success || 0) / waSent) * 100) : null, retrying: waRetry.scheduled || 0, dead: waRetry.dead || 0 },
    ai,
    integrations: { active: connectors, deadEvents: intakeDead },
  };
  return { ...o, ...assess(o) };
}
export type Overview = Awaited<ReturnType<typeof overview>>;

type Level = "critical" | "warning" | "good" | "info";
export interface Signal {
  level: Level;
  area: string;
  title: string;
  detail: string;
  href?: string;
}

/** Rules that turn the numbers into "needs attention" and "going well" — deterministic and explainable. */
function assess(o: any) {
  const s: Signal[] = [];
  const add = (level: Level, area: string, title: string, detail: string, href?: string) => s.push({ level, area, title, detail, href });
  const L = o.leads;
  const open = o.pipeline.open;

  if (o.followups.overdue) add(o.followups.overdue >= 10 || o.followups.overdue >= open * 0.25 ? "critical" : "warning", "Follow-ups", `${o.followups.overdue} follow-up${o.followups.overdue > 1 ? "s" : ""} overdue`, "Leads were promised a call-back that hasn't happened — every day of delay lowers conversion.", "/app/leads?sort=updated");
  if (o.speed.uncontacted24h) add(o.speed.uncontacted24h >= 10 ? "critical" : "warning", "Speed to lead", `${o.speed.uncontacted24h} new lead${o.speed.uncontacted24h > 1 ? "s" : ""} not contacted for 24 h+`, `Oldest has waited ${o.speed.oldestNewHours >= 48 ? `${Math.round(o.speed.oldestNewHours / 24)} days` : `${o.speed.oldestNewHours} h`}. Leads contacted within an hour convert far better.`, "/app/leads?status=New");
  if (L.totalPrev >= 5 && L.change <= -30) add("warning", "Lead flow", `Lead volume down ${Math.abs(L.change)}%`, `${L.total} leads vs ${L.totalPrev} in the previous ${o.days} days. Check campaigns and integrations.`, "/app/integrations");
  if (L.totalPrev >= 5 && L.change >= 20) add("good", "Lead flow", `Lead volume up ${L.change}%`, `${L.total} leads vs ${L.totalPrev} in the previous ${o.days} days.`);
  if (L.totalPrev >= 10 && L.convDelta <= -5) add("warning", "Conversion", `Conversion fell ${Math.abs(L.convDelta)} pts to ${L.conv}%`, `It was ${L.convPrev}% in the previous ${o.days} days.`, "/app/reports");
  if (L.totalPrev >= 10 && L.convDelta >= 5) add("good", "Conversion", `Conversion up ${L.convDelta} pts to ${L.conv}%`, `From ${L.convPrev}% in the previous ${o.days} days.`);
  else if (L.total >= 10 && L.conv >= 20) add("good", "Conversion", `Strong conversion at ${L.conv}%`, `${L.won} of ${L.total} leads converted.`);
  const ranked = o.sources.filter((x: any) => x.n >= 5);
  const best = [...ranked].sort((a: any, b: any) => b.conv - a.conv)[0];
  if (best && best.conv > 0) add("good", "Sources", `${best.source} converts best (${best.conv}%)`, `${best.won} of ${best.n} leads from ${best.source} converted — worth more budget.`);
  for (const x of o.sources.filter((y: any) => y.n >= 10 && y.won === 0).slice(0, 2)) add("warning", "Sources", `${x.source}: ${x.n} leads, none converted`, "Review lead quality or the follow-up script for this source.");
  const lostTop = o.lostReasons[0];
  if (lostTop && L.lost >= 5 && lostTop.n / L.lost >= 0.4) add("warning", "Lost deals", `“${lostTop.reason}” causes ${Math.round((lostTop.n / L.lost) * 100)}% of losses`, `${lostTop.n} of ${L.lost} lost leads this period.`);
  if (o.money.overdueCount) add("critical", "Collections", `${inr(o.money.overdue)} over due from ${o.money.overdueCount} payment${o.money.overdueCount > 1 ? "s" : ""}`, "Send reminders from Client › Subscription Management.", "/app/clients?tab=subscription");
  if (o.money.collectedPrev > 0 && o.money.collectedChange >= 10) add("good", "Collections", `Collections up ${o.money.collectedChange}%`, `${inr(o.money.collected)} collected vs ${inr(o.money.collectedPrev)} before.`);
  if (o.money.collectedPrev > 0 && o.money.collectedChange <= -30) add("warning", "Collections", `Collections down ${Math.abs(o.money.collectedChange)}%`, `${inr(o.money.collected)} vs ${inr(o.money.collectedPrev)} in the previous period.`, "/app/clients?tab=subscription");
  if (o.money.upcomingCount) add("info", "Collections", `${inr(o.money.upcoming)} due in the next 7 days`, `${o.money.upcomingCount} payment${o.money.upcomingCount > 1 ? "s" : ""} — a reminder now avoids over dues.`, "/app/clients?tab=subscription");
  if (o.support.grievances) add("critical", "Support", `${o.support.grievances} open grievance${o.support.grievances > 1 ? "s" : ""}`, "Grievances hurt retention — resolve or respond today.", "/app/clients?tab=support");
  if (o.support.stale48h) add("warning", "Support", `${o.support.stale48h} ticket${o.support.stale48h > 1 ? "s" : ""} open for 48 h+`, "Clients are waiting — update the status so they're notified.", "/app/clients?tab=support");
  if (o.support.resolved >= 3 && o.support.avgResolutionHours != null && o.support.avgResolutionHours <= 24) add("good", "Support", `Tickets resolved in ${o.support.avgResolutionHours} h on average`, `${o.support.resolved} resolved this period.`);
  if (o.clients.new && o.clients.new > o.clients.newPrev) add("good", "Clients", `${o.clients.new} new client${o.clients.new > 1 ? "s" : ""}`, o.clients.newPrev ? `Up from ${o.clients.newPrev} in the previous period.` : "Welcome aboard!");
  if (o.whatsapp.dead) add("critical", "WhatsApp", `${o.whatsapp.dead} message${o.whatsapp.dead > 1 ? "s" : ""} could not be delivered`, "The provider kept failing — resend them from WhatsApp Logs.", "/app/settings/whatsapp-logs");
  else if (o.whatsapp.sent >= 10 && o.whatsapp.successRate != null && o.whatsapp.successRate < 90) add("warning", "WhatsApp", `Only ${o.whatsapp.successRate}% of WhatsApp messages delivered`, `${o.whatsapp.failed} failed of ${o.whatsapp.sent}. Check the webhook settings.`, "/app/settings/whatsapp-logs");
  else if (o.whatsapp.sent >= 20 && o.whatsapp.successRate >= 98) add("good", "WhatsApp", `${o.whatsapp.successRate}% WhatsApp delivery`, `${o.whatsapp.sent} messages sent.`);
  if (o.whatsapp.retrying) add("info", "WhatsApp", `${o.whatsapp.retrying} message${o.whatsapp.retrying > 1 ? "s" : ""} waiting for automatic retry`, "The provider was unavailable — they'll go out automatically.", "/app/settings/whatsapp-logs");
  for (const a of o.ai) {
    if (a.credits && a.remaining <= 0) add("critical", "AI", `${a.model}: AI credits exhausted`, "The assistant and AI reports are paused until credits are topped up.", "/app/settings/ai-agents");
    else if (a.credits && a.remaining / a.credits < 0.1) add("warning", "AI", `${a.model}: ${Math.round((a.remaining / a.credits) * 100)}% AI credits left`, `${a.remaining.toFixed(1)} of ${a.credits} credits remain.`, "/app/settings/ai-agents");
  }
  if (o.integrations.deadEvents) add("warning", "Integrations", `${o.integrations.deadEvents} incoming lead${o.integrations.deadEvents > 1 ? "s" : ""} failed to import`, "An integration kept failing — check Integration › events.", "/app/integrations");

  const crit = s.filter((x) => x.level === "critical").length;
  const warn = s.filter((x) => x.level === "warning").length;
  const good = s.filter((x) => x.level === "good").length;
  const score = Math.max(0, Math.min(100, 100 - crit * 16 - warn * 7 + good * 2));
  const label = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Needs attention" : "At risk";
  const order: Record<Level, number> = { critical: 0, warning: 1, info: 2, good: 3 };
  s.sort((a, b) => order[a.level] - order[b.level]);
  return { signals: s, health: { score, label, critical: crit, warning: warn, good } };
}

/* ───────────── AI recommendations ───────────── */

/** Numbers only — no names, phones or other personal data ever leave for the AI provider. */
function snapshot(o: Overview) {
  return {
    period_days: o.days,
    leads: o.leads,
    open_pipeline: o.pipeline,
    speed_to_lead: o.speed,
    followups: { overdue: o.followups.overdue, due_today: o.followups.dueToday },
    sources: o.sources.slice(0, 8),
    lost_reasons: o.lostReasons.slice(0, 5),
    clients: o.clients,
    collections_inr: o.money,
    support: o.support,
    whatsapp: o.whatsapp,
    ai_credits: o.ai,
    integrations: o.integrations,
    signals: o.signals.map((x) => `${x.level}: ${x.title}`),
  };
}

export interface Recommendation {
  priority: "high" | "medium" | "low";
  area: string;
  title: string;
  action: string;
  why: string;
}

const ACTIONS: Record<string, string> = {
  "Follow-ups": "Block 30 minutes now and clear the overdue call-backs, oldest first; set the next follow-up date on each.",
  "Speed to lead": "Assign every new lead within the hour and turn on the “New lead captured” WhatsApp acknowledgement.",
  "Lead flow": "Check that each integration is active and compare campaign spend with last period.",
  Conversion: "Review the last 10 lost leads for a common objection and update the call script.",
  Sources: "Shift budget toward the best-converting source; pause or fix sources that bring leads but no conversions.",
  "Lost deals": "Address the top lost reason directly — e.g. a price-match offer or a faster appointment slot.",
  Collections: "Send payment reminders today (Client › Subscription Management › Reminder).",
  Support: "Respond to every open grievance today and move stale tickets forward so clients are notified.",
  Clients: "Welcome new clients personally and confirm their next service date.",
  WhatsApp: "Open WhatsApp Logs, fix the webhook if needed and resend undelivered messages.",
  AI: "Ask your Super Admin to top up AI credits before the assistant pauses.",
  Integrations: "Open Integration › events, fix the failing connector and retry the failed leads.",
};

/** Deterministic recommendations from the signals — used when no AI model is available (or the provider is down). */
export function ruleRecommendations(o: Overview): Recommendation[] {
  const seen = new Set<string>();
  const out: Recommendation[] = [];
  for (const x of o.signals) {
    if (x.level === "good" || x.level === "info" || seen.has(x.area)) continue;
    seen.add(x.area);
    out.push({ priority: x.level === "critical" ? "high" : "medium", area: x.area, title: x.title, action: ACTIONS[x.area] || "Review this area today.", why: x.detail });
    if (out.length >= 5) break;
  }
  if (!out.length) out.push({ priority: "low", area: "Growth", title: "Everything is on track", action: "Use the quiet time to re-engage leads lost on price or timing last month.", why: "No alerts in this period." });
  return out;
}

/** Which AI model answers: the company assistant, else any company agent with a model, else any allocated model. */
async function pickModel(companyId: string) {
  const cas = await CompanyAgent.find({ companyId, active: true, agentId: { $ne: null } }).sort({ isAssistant: -1, updatedAt: -1 }).limit(5).lean<any[]>();
  const allocs = await AiAllocation.find({ companyId, allocated: { $ne: false } }).lean<any[]>();
  const usable = (agentId: any) => allocs.some((a) => String(a.agentId) === String(agentId) && (a.credits || 0) - (a.used || 0) > 0);
  for (const ca of cas) if (usable(ca.agentId)) {
    const agent = await AiAgent.findOne({ _id: ca.agentId, active: true }).lean<any>();
    if (agent) return { agent, ca };
  }
  for (const a of allocs) if (usable(a.agentId)) {
    const agent = await AiAgent.findOne({ _id: a.agentId, active: true }).lean<any>();
    if (agent) return { agent, ca: null };
  }
  return null;
}

/**
 * Recommendations for the dashboard — regenerated whenever the underlying numbers change (cache key = hash of the
 * snapshot), so refreshing with unchanged data costs no AI credits; `force` regenerates anyway.
 */
export async function recommendations(companyId: string, o: Overview, opts: { force?: boolean; userId?: string } = {}) {
  const snap = snapshot(o);
  const hash = crypto.createHash("sha1").update(JSON.stringify({ ...snap, generatedAt: undefined })).digest("hex").slice(0, 16);
  const build = async () => {
    const pick = await pickModel(companyId);
    if (!pick) return { source: "rules" as const, note: "No AI model with credits is allocated — showing rule-based recommendations.", summary: "", recommendations: ruleRecommendations(o), at: new Date().toISOString(), hash };
    const company = await Company.findById(companyId).select("name").lean<any>();
    try {
      const r = await withAgentDb(companyId, pick.agent._id, () =>
        complete({
          agent: pick.agent,
          companyId,
          companyAgentId: pick.ca?._id,
          userId: opts.userId,
          purpose: "insights",
          json: true,
          maxTokens: 900,
          timeoutMs: 40_000,
          system: `You are a sharp operations and growth advisor for ${company?.name || "an Indian business"} (a lead management + client servicing business). From the live metrics JSON, write what management should do next. Be specific, use the numbers, prioritise what protects revenue first. Never invent data. Reply with ONLY JSON:
{"summary": "one sentence on the state of the business", "recommendations": [{"priority": "high|medium|low", "area": "short area", "title": "what is happening (≤ 10 words)", "action": "the concrete next step (≤ 25 words)", "why": "the number that justifies it (≤ 20 words)"}]}
3 to 5 recommendations, highest priority first.`,
          messages: [{ role: "user", content: JSON.stringify(snap) }],
        })
      );
      const j = parseJson(r.text);
      const recs = Array.isArray(j?.recommendations) ? j.recommendations.slice(0, 6).map((x: any) => ({ priority: ["high", "medium", "low"].includes(x.priority) ? x.priority : "medium", area: String(x.area || "General").slice(0, 40), title: String(x.title || "").slice(0, 120), action: String(x.action || "").slice(0, 300), why: String(x.why || "").slice(0, 200) })).filter((x: any) => x.title && x.action) : [];
      if (!recs.length) throw new Error("empty answer");
      return { source: "ai" as const, model: pick.agent.name, summary: String(j.summary || "").slice(0, 300), recommendations: recs, at: new Date().toISOString(), hash, credits: r.usage?.credits };
    } catch (e: any) {
      return { source: "rules" as const, note: `AI unavailable (${String(e?.message || e).slice(0, 120)}) — showing rule-based recommendations.`, summary: "", recommendations: ruleRecommendations(o), at: new Date().toISOString(), hash };
    }
  };
  const key = `insights:${companyId}:${o.days}:${hash}`;
  const { invalidate } = await import("./cache");
  if (opts.force) await invalidate(key);
  // a good answer is kept while the numbers stay the same; an outage fallback is only kept for 2 minutes
  const r = await cached(key, 6 * 3600, build);
  if (r.source === "rules" && /^AI unavailable/.test((r as any).note || "")) {
    const age = Date.now() - new Date(r.at).getTime();
    if (age > 120_000) {
      await invalidate(key);
      return cached(key, 6 * 3600, build);
    }
  }
  return r;
}

/** WhatsApp-friendly digest text (the webhook flattens line breaks when it must). */
export function digestText(companyName: string, o: Overview, rec: Awaited<ReturnType<typeof recommendations>>) {
  const L = o.leads;
  const top = o.signals.filter((x) => x.level === "critical" || x.level === "warning").slice(0, 3);
  const wins = o.signals.filter((x) => x.level === "good").slice(0, 2);
  const lines = [
    `📊 ${companyName} — ${o.days}-day snapshot · Health ${o.health.score}/100 (${o.health.label})`,
    `Leads ${L.total} (${L.change >= 0 ? "+" : ""}${L.change}%) · Converted ${L.won} · Conversion ${L.conv}%`,
    `Collected ${inr(o.money.collected)}${o.money.overdueCount ? ` · Over due ${inr(o.money.overdue)}` : ""} · Open tickets ${o.support.open}`,
    top.length ? `⚠️ Needs attention: ${top.map((x) => x.title).join("; ")}` : "✅ Nothing alarming.",
    wins.length ? `👍 Going well: ${wins.map((x) => x.title).join("; ")}` : "",
    `💡 ${rec.source === "ai" ? "AI recommendations" : "Recommendations"}:`,
    ...rec.recommendations.slice(0, 3).map((r: Recommendation, i: number) => `${i + 1}. ${r.title} — ${r.action}`),
  ];
  return lines.filter(Boolean).join("\n");
}

/* ───────────── WhatsApp: AI insights digest ───────────── */

/**
 * Builds the snapshot + recommendations and sends them through the "AI insights" webhook(s) to the company admin
 * (and each webhook's additional numbers). webhookId = one scheduled webhook; otherwise every active one.
 */
export async function sendInsights(companyId: string, days: number, opts: { trigger: "manual" | "cron"; by?: string; webhookId?: any }) {
  const db = await dbOf(companyId);
  return runInDb(db, async () => {
    const [company, owner] = await Promise.all([Company.findById(companyId).select("name whatsapp phone").lean<any>(), User.findOne({ companyId, isOwner: true }).select("name phone").lean<any>()]);
    const phone = owner?.phone || company?.whatsapp || company?.phone;
    if (!phone) return { sent: 0, reason: "No WhatsApp number for the company admin (add one to the owner's user or the company)." };
    const o = await overview(companyId, days);
    const rec = await recommendations(companyId, o, {});
    const ctx = {
      phone,
      name: owner?.name || company?.name,
      company: company?.name,
      message: digestText(company?.name || "", o, rec),
      params: { health_score: o.health.score, health: o.health.label, leads: o.leads.total, conversion: o.leads.conv, collected: Math.round(o.money.collected), overdue: Math.round(o.money.overdue), alerts: o.health.critical + o.health.warning },
    };
    const { fireEvent, dispatch } = await import("./whatsapp");
    if (opts.webhookId) {
      const hook = await Webhook.findOne({ _id: opts.webhookId, companyId, event: "ai_insights", active: true }).lean<any>();
      if (!hook) return { sent: 0, reason: "The AI insights webhook is missing or switched off" };
      const results = await dispatch(hook, ctx as any, { scope: "company", companyId, trigger: opts.trigger, triggeredBy: opts.by });
      return { sent: results.filter((x: any) => x.ok).length, results, source: rec.source };
    }
    const r = await fireEvent("company", companyId, "ai_insights", ctx as any, opts.trigger, opts.by);
    return { ...r, source: rec.source };
  });
}

defineJob(
  "ai.insights",
  async (p) => {
    const r: any = await sendInsights(p.companyId, p.days || 7, { trigger: "cron", webhookId: p.webhookId });
    if (!r.sent && !/missing|switched off|No WhatsApp number/.test(r.reason || "")) throw new Error(r.reason || "not sent");
    return { done: true, result: { sent: r.sent, source: r.source, reason: r.reason } };
  },
  { maxAttempts: 4 }
);

/**
 * Hourly: queue the AI insights digest for every webhook whose schedule matches this IST hour (and weekday for weekly).
 * Idempotent — a webhook is claimed once per day/week (lastScheduledKey) and the job has an idempotency key.
 */
export async function scheduleInsights(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const hour = ist.getUTCHours();
  const weekday = ist.getUTCDay();
  const day = ist.toISOString().slice(0, 10);
  let queued = 0;
  await forEachCompanyDb(async (c) => {
    const hooks = await Webhook.find({ scope: "company", companyId: c._id, event: "ai_insights", active: true, "schedule.freq": { $in: ["daily", "weekly"] }, "schedule.hour": hour }).lean<any[]>();
    for (const h of hooks) {
      if (h.schedule.freq === "weekly" && (h.schedule.weekday ?? 1) !== weekday) continue;
      const key = h.schedule.freq === "weekly" ? `w:${day}` : `d:${day}`;
      const claimed = await Webhook.updateOne({ _id: h._id, lastScheduledKey: { $ne: key } }, { $set: { lastScheduledKey: key } });
      if (!claimed.modifiedCount) continue; // already queued this period (another instance / a re-run)
      await enqueue("ai.insights", { companyId: String(c._id), webhookId: String(h._id), days: h.schedule.days || (h.schedule.freq === "weekly" ? 7 : 1) }, { companyId: c._id, idemKey: `insights:${h._id}:${key}` });
      queued++;
    }
  });
  return queued;
}

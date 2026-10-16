/**
 * Client module: leads that reached "Converted / Service Initiated" become clients with a Client ID, sit on an editable
 * Kanban board (service status), raise support tickets and are billed through Payment Details → payments.
 * Every function runs inside the company's own database (request context).
 */
import { randomBytes } from "crypto";
import { Lead, Counter, ClientBoard, ClientPlan, ClientPayment, Company } from "../models";
import { WON_STATUS } from "../../shared/constants";
import { addClientPeriod } from "../../shared/clients";
import { cached } from "./cache";

export const DEFAULT_COLUMNS = [
  { name: "Onboarding", color: "#6366f1" },
  { name: "In Progress", color: "#0ea5e9" },
  { name: "On Hold", color: "#f59e0b" },
  { name: "Delivered", color: "#10b981" },
  { name: "Closed", color: "#64748b" },
];
export const newColumnId = () => `col_${randomBytes(4).toString("hex")}`;

export async function nextSeq(name: string) {
  const r = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean<any>();
  return r.seq as number;
}

/** The company's board (created with default columns on first use). */
export async function getBoard(companyId: any) {
  let b = await ClientBoard.findOne({ companyId }).lean<any>();
  if (!b) {
    b = await ClientBoard.findOneAndUpdate({ companyId }, { $setOnInsert: { companyId, columns: DEFAULT_COLUMNS.map((c) => ({ id: newColumnId(), ...c })) } }, { upsert: true, new: true }).lean<any>();
  }
  return b;
}

const companyCode = (companyId: any) => cached(`co:code:${companyId}`, 3600, async () => (await Company.findById(companyId).select("code").lean<any>())?.code || "CL");

/**
 * Converted leads → clients. Called right after a status change (ids given) and, as a catch-all, when the Client
 * module loads (covers conversions from integrations, imports, bulk updates). Idempotent and race-safe.
 */
export async function promoteClients(companyId: any, ids?: any[]) {
  const q: any = { companyId, deletedAt: null, status: WON_STATUS, isClient: { $ne: true } };
  if (ids?.length) q._id = { $in: ids };
  const leads = await Lead.find(q).select("_id").limit(500).lean<any[]>();
  if (!leads.length) return [];
  const [board, code] = await Promise.all([getBoard(companyId), companyCode(companyId)]);
  const first = board.columns[0]?.id;
  const out: { id: string; clientCode: string }[] = [];
  for (const l of leads) {
    const clientCode = `${code}-C${String(await nextSeq("client")).padStart(4, "0")}`;
    const now = new Date();
    const r = await Lead.updateOne(
      { _id: l._id, isClient: { $ne: true } },
      { $set: { isClient: true, clientCode, clientSince: now, serviceStage: first, stageAt: now }, $push: { remarks: { at: now, by: "system", text: `Moved to Clients · Client ID ${clientCode}` } } }
    );
    if (r.modifiedCount) out.push({ id: String(l._id), clientCode });
  }
  return out;
}

const startOfTodayIST = () => new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30");

/** Unpaid dues past their date become Over-Due (one indexed update). */
export async function refreshOverdue(companyId: any) {
  await ClientPayment.updateMany({ companyId, status: "unpaid", dueDate: { $lt: startOfTodayIST() } }, { $set: { status: "overdue" } });
}

/**
 * Recurring Payment Details → one payment per period, from the start date up to the next upcoming due (so the list
 * always shows what is due next). Unique (planId, dueDate) makes this safe to run any number of times.
 */
export async function ensureRecurringDues(companyId: any, planIds?: any[]) {
  const q: any = { companyId, type: "recurring", active: true };
  if (planIds?.length) q._id = { $in: planIds };
  const plans = await ClientPlan.find(q).lean<any[]>();
  const horizon = new Date(Date.now() + 1 * 86_400_000);
  for (const p of plans) {
    if (!p.startDate || p.frequency === "on_demand") continue;
    const last = await ClientPayment.findOne({ planId: p._id }).sort({ dueDate: -1 }).select("dueDate").lean<any>();
    if (last && new Date(last.dueDate) > horizon) continue; // the upcoming due already exists
    let due = last ? addClientPeriod(last.dueDate, p.frequency) : new Date(p.startDate);
    const docs: any[] = [];
    // backfill missed periods (at most 24), then stop at the first due date after today
    for (let i = 0; i < 24; i++) {
      docs.push({ companyId, kind: "recurring", planId: p._id, clientId: p.clientId, clientCode: p.clientCode, clientName: p.clientName, services: [p.serviceType], dueDate: due, amount: p.amount, gross: p.amount, status: "unpaid" });
      if (due > horizon) break;
      due = addClientPeriod(due, p.frequency);
    }
    if (docs.length) await ClientPayment.insertMany(docs, { ordered: false }).catch((e: any) => (e?.code === 11000 || e?.writeErrors ? undefined : Promise.reject(e)));
  }
}

/** Throttled per company: dues + overdue are refreshed at most every 5 minutes on reads; the daily job does all companies. */
export async function refreshBilling(companyId: any, force = false) {
  const run = async () => {
    await ensureRecurringDues(companyId);
    await refreshOverdue(companyId);
    return Date.now();
  };
  if (force) return run();
  return cached(`clientbill:${companyId}`, 300, run);
}

/** Best number to reach a client on WhatsApp. */
export const clientPhone = (c: any) => c?.whatsapp || c?.phone || c?.business?.ownerPhone || "";

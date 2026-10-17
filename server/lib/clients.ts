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
/** Run a background-style safety net at most once per `ms` per key on this instance (keeps list reads cheap). */
const lastRun = new Map<string, number>();
export function throttled(key: string, ms: number) {
  const now = Date.now();
  if ((lastRun.get(key) || 0) + ms > now) return false;
  lastRun.set(key, now);
  return true;
}

const inrFmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");

/**
 * WhatsApp to a client for a Client-module event (registered in shared/events.ts). Never throws and never blocks the
 * caller — a missing webhook or number just means nothing is sent (it's in WhatsApp Logs when it is).
 */
export function notifyClient(
  companyId: any,
  event: "client_created" | "client_stage_changed" | "client_payment_received" | "client_payment_overdue",
  client: any,
  message: (company: string) => string,
  params: Record<string, any>
) {
  const phone = clientPhone(client);
  if (!phone) return;
  (async () => {
    const [{ fireEvent }, company] = await Promise.all([import("./whatsapp"), cached(`clientco:${companyId}`, 300, () => Company.findById(companyId).select("name").lean<any>())]);
    const name = company?.name || "";
    await fireEvent("company", String(companyId), event, { phone, name: client.name, company: name, message: message(name), params: { client_id: client.clientCode, ...params } });
  })().catch(() => undefined);
}

/** <company base URL>/support — own URL if set, else <slug>.<platform base>. */
async function supportUrlOf(companyId: any) {
  const [{ tenantUrls }, c] = await Promise.all([import("./tenant"), Company.findById(companyId).select("slug customDomain").lean<any>()]);
  const u = tenantUrls(c || {});
  const base = u.customUrl || u.platformUrl;
  return base ? `${base}/support` : "";
}

export async function promoteClients(companyId: any, ids?: any[]) {
  const q: any = { companyId, deletedAt: null, status: WON_STATUS, isClient: { $ne: true } };
  if (ids?.length) q._id = { $in: ids };
  const leads = await Lead.find(q).select("_id name whatsapp phone business.ownerPhone").limit(500).lean<any[]>();
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
    if (r.modifiedCount) {
      out.push({ id: String(l._id), clientCode });
      const url = await supportUrlOf(companyId).catch(() => "");
      notifyClient(companyId, "client_created", { ...l, clientCode }, (co) => `Hi ${l.name || ""}, welcome to ${co}! Your Client ID is ${clientCode}.${url ? ` For any support, visit ${url} and sign in with your Client ID and this mobile number.` : ""}`.replace(/\s+/g, " ").trim(), { support_url: url });
    }
  }
  return out;
}

const startOfTodayIST = () => new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30");

/** Unpaid dues past their date become Over-Due (one indexed update). */
export async function refreshOverdue(companyId: any) {
  const q = { companyId, status: "unpaid", dueDate: { $lt: startOfTodayIST() } };
  const due = await ClientPayment.find(q).select("_id clientId clientCode clientName gross dueDate").limit(500).lean<any[]>();
  if (!due.length) return;
  const r = await ClientPayment.updateMany({ _id: { $in: due.map((d) => d._id) }, status: "unpaid" }, { $set: { status: "overdue" } });
  if (!r.modifiedCount) return;
  // tell each client once (this transition only happens once per payment)
  const clients = await Lead.find({ _id: { $in: [...new Set(due.map((d) => String(d.clientId)))] } }).select("name whatsapp phone business.ownerPhone clientCode").lean<any[]>();
  for (const p of due) {
    const c = clients.find((x) => String(x._id) === String(p.clientId));
    if (c) notifyClient(companyId, "client_payment_overdue", c, (co) => `Hi ${c.name || ""}, your payment of ${inrFmt(p.gross)} to ${co} was due on ${dmy(p.dueDate)} and is now over due. Please pay at the earliest.`, { amount: p.gross, due_date: dmy(p.dueDate) });
  }
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

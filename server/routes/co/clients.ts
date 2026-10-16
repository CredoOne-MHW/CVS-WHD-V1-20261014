/**
 * Company › Client module API.
 *   /service-types          service master (Leads › Service and payments › Service Type share it)
 *   /clients…               list · profile + journey · edit · Kanban board · support tickets · Payment Details · payments
 * All data lives in the company's own database; every query is tenant-scoped and indexed.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Lead, Company, ServiceType, ClientBoard, SupportTicket, ClientPlan, ClientPayment } from "../../models";
import { can, tenant } from "../../middleware/auth";
import { h, parse, notFound, badRequest, forbidden, paging, escapeRegex, HttpError } from "../../lib/http";
import { encrypt } from "../../lib/crypto";
import { fireEvent } from "../../lib/whatsapp";
import { cached, invalidate } from "../../lib/cache";
import { getBoard, newColumnId, promoteClients, refreshBilling, ensureRecurringDues, refreshOverdue, nextSeq, clientPhone } from "../../lib/clients";
import { normalizePhone } from "../../../shared/constants";
import { CLIENT_FREQ_KEYS, PAYMENT_MODES, SUPPORT_CATEGORIES, TICKET_STATUS_LIST, GST_RE, PAN_RE, aadhaarValid, maskAadhaar, applyDiscount, clientFreqLabel, round2 } from "../../../shared/clients";

const r = Router();
const oid = (s: any) => new mongoose.Types.ObjectId(String(s));
const isId = (s: any) => mongoose.isValidObjectId(s);

/** Any one of these permissions is enough (e.g. the service master is used from Leads and from Clients). */
const canAny =
  (pairs: [string, "create" | "read" | "update" | "delete"][]) =>
  (req: Request, res: Response, next: NextFunction) => {
    res.locals.module = pairs[0][0];
    if (pairs.some(([m, a]) => req.auth?.perms?.[m]?.[a])) return next();
    next(forbidden("No access"));
  };

/* ───────────── business details (shared with Leads) ───────────── */
const blank = z.literal("");
export const businessBody = z
  .object({
    gst: z.string().trim().toUpperCase().regex(GST_RE, "GSTIN looks wrong — 15 characters like 19AAACW1234F1Z5").or(blank),
    tradeLicence: z.string().trim().max(60).or(blank),
    pan: z.string().trim().toUpperCase().regex(PAN_RE, "Company PAN looks wrong — like AAACW1234F").or(blank),
    registeredAddress: z.string().trim().max(500).or(blank),
    communicationAddress: z.string().trim().max(500).or(blank),
    commSameAsRegistered: z.boolean(),
    ownerEmail: z.string().trim().toLowerCase().email("Owner email looks wrong").or(blank),
    ownerPhone: z.string().trim().or(blank),
    ownerPan: z.string().trim().toUpperCase().regex(PAN_RE, "Owner PAN looks wrong — like ABCDE1234F").or(blank),
    ownerAadhaar: z.string().trim().transform((v) => v.replace(/\s/g, "")).refine((v) => v === "" || aadhaarValid(v), "Aadhaar number is not valid (12 digits, checksum)"),
    clearAadhaar: z.boolean(),
  })
  .partial();
export type BusinessInput = z.infer<typeof businessBody>;

/** Applies validated business fields onto a lead document (Aadhaar encrypted, only last 4 kept readable). */
export function applyBusiness(lead: any, b?: BusinessInput) {
  if (!b) return;
  const cur = lead.business?.toObject ? lead.business.toObject() : { ...(lead.business || {}) };
  const next: any = { ...cur };
  for (const k of ["gst", "tradeLicence", "pan", "registeredAddress", "communicationAddress", "ownerEmail", "ownerPan"] as const) if (b[k] !== undefined) next[k] = b[k] || undefined;
  if (b.commSameAsRegistered !== undefined) next.commSameAsRegistered = b.commSameAsRegistered;
  if (next.commSameAsRegistered) next.communicationAddress = next.registeredAddress;
  if (b.ownerPhone !== undefined) {
    const p = b.ownerPhone ? normalizePhone(b.ownerPhone) : "";
    if (b.ownerPhone && !p) throw badRequest("Owner number should be a 10-digit mobile number");
    next.ownerPhone = p || undefined;
  }
  if (b.clearAadhaar) {
    next.ownerAadhaarEnc = undefined;
    next.ownerAadhaarLast4 = undefined;
  } else if (b.ownerAadhaar) {
    next.ownerAadhaarEnc = encrypt(b.ownerAadhaar);
    next.ownerAadhaarLast4 = b.ownerAadhaar.slice(-4);
  }
  lead.business = next;
}

/** Never send the encrypted Aadhaar to the browser — only the masked form. */
export function safeLead(l: any) {
  if (!l) return l;
  const o = l.toObject ? l.toObject() : { ...l };
  if (o.business) {
    const { ownerAadhaarEnc, ...rest } = o.business;
    o.business = { ...rest, ownerAadhaarMasked: maskAadhaar(rest.ownerAadhaarLast4), hasAadhaar: !!ownerAadhaarEnc };
  }
  return o;
}

/** Services must exist in the master (keeps reports clean). */
async function assertServices(companyId: any, names?: string[]) {
  if (!names?.length) return [];
  const clean = [...new Set(names.map((s) => s.trim()).filter(Boolean))];
  const found = await ServiceType.find({ companyId, key: { $in: clean.map((s) => s.toLowerCase()) } }).select("name").lean<any[]>();
  const map = new Map(found.map((f) => [f.name.toLowerCase(), f.name]));
  const missing = clean.filter((s) => !map.has(s.toLowerCase()));
  if (missing.length) throw badRequest(`Not in the service list: ${missing.join(", ")} — add it first`);
  return clean.map((s) => map.get(s.toLowerCase())!);
}
export { assertServices };

/* ───────────── Service master ───────────── */
const svcKey = (cid: string) => `svc:${cid}`;
r.get("/service-types", canAny([["leads", "read"], ["clients", "read"]]), h(async (req, res) => {
  const cid = tenant(req).companyId;
  res.json(await cached(svcKey(cid), 300, () => ServiceType.find({ companyId: cid }).sort({ name: 1 }).select("name").lean()));
}));
r.post("/service-types", canAny([["leads", "update"], ["leads", "create"], ["clients", "update"], ["clients", "create"]]), h(async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(2, "Service name is too short").max(80) }), req.body);
  const cid = tenant(req).companyId;
  const doc = await ServiceType.findOneAndUpdate({ companyId: cid, key: name.toLowerCase() }, { $setOnInsert: { companyId: cid, name, key: name.toLowerCase() } }, { upsert: true, new: true }).lean();
  await invalidate(svcKey(cid));
  res.locals.item = name;
  res.status(201).json(doc);
}));
r.delete("/service-types/:id", canAny([["leads", "update"], ["clients", "update"]]), h(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const cid = tenant(req).companyId;
  const d = await ServiceType.findOneAndDelete({ _id: req.params.id, companyId: cid }).lean<any>();
  if (!d) throw notFound();
  await invalidate(svcKey(cid));
  res.locals.item = d.name;
  res.json({ ok: true }); // existing leads/payments keep the name they were saved with
}));

/* ───────────── Clients: list, picker, profile + journey, edit ───────────── */
const CLIENT_LIST_FIELDS = "name phone whatsapp email clientCode clientSince serviceStage stageAt services source campaign business.gst business.ownerPhone";

r.get("/clients", can("clients", "read"), h(async (req, res) => {
  const cid = tenant(req).companyId;
  await promoteClients(cid); // catch conversions made by integrations / imports / bulk updates
  const { page, limit, skip } = paging(req.query);
  const q: any = { companyId: cid, deletedAt: null, isClient: true };
  if (req.query.stage) q.serviceStage = String(req.query.stage);
  if (req.query.service) q.services = String(req.query.service);
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q)), $options: "i" };
    q.$or = [{ name: rx }, { clientCode: rx }, { phone: rx }, { whatsapp: rx }, { email: rx }];
  }
  const [items, total, board] = await Promise.all([Lead.find(q).sort({ clientSince: -1 }).skip(skip).limit(limit).select(CLIENT_LIST_FIELDS).lean<any[]>(), Lead.countDocuments(q), getBoard(cid)]);
  // outstanding dues for the clients on this page (one grouped query)
  const due = items.length
    ? await ClientPayment.aggregate([{ $match: { companyId: oid(cid), clientId: { $in: items.map((i) => i._id) }, status: { $in: ["unpaid", "overdue"] } } }, { $group: { _id: "$clientId", n: { $sum: 1 }, amount: { $sum: "$gross" } } }])
    : [];
  const dueBy = new Map(due.map((d: any) => [String(d._id), d]));
  res.json({ items: items.map((i) => ({ ...i, outstanding: dueBy.get(String(i._id)) || null })), total, page, limit, columns: board.columns });
}));

/** Searchable single-select options (Client ID · name). */
r.get("/clients/options", canAny([["clients", "read"]]), h(async (req, res) => {
  const q: any = { ...tenant(req), deletedAt: null, isClient: true };
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q)), $options: "i" };
    q.$or = [{ name: rx }, { clientCode: rx }, { phone: rx }];
  }
  const rows = await Lead.find(q).sort({ clientSince: -1 }).limit(Math.min(500, Number(req.query.limit) || 200)).select("name clientCode phone whatsapp").lean<any[]>();
  res.json(rows.map((c) => ({ value: String(c._id), label: `${c.clientCode} · ${c.name || c.phone || "Client"}`, hint: c.whatsapp || c.phone })));
}));

/** Price for the chosen services from the client's Payment Details (on-demand mapping first, else any). */
r.get("/clients/price", can("clients", "read"), h(async (req, res) => {
  if (!isId(req.query.clientId)) throw badRequest("Pick a client");
  const services = String(req.query.services || "").split(",").map((s) => s.trim()).filter(Boolean);
  const plans = await ClientPlan.find({ ...tenant(req), clientId: req.query.clientId, serviceType: { $in: services }, active: true }).sort({ type: 1, updatedAt: -1 }).lean<any[]>();
  const lines = services.map((s) => {
    const p = plans.find((x) => x.serviceType === s && x.type === "on_demand") || plans.find((x) => x.serviceType === s);
    return { service: s, amount: p ? p.amount : null };
  });
  res.json({ lines, amount: round2(lines.reduce((a, l) => a + (l.amount || 0), 0)), missing: lines.filter((l) => l.amount == null).map((l) => l.service) });
}));

async function loadClient(req: Request) {
  if (!isId(req.params.id)) throw notFound();
  const c = await Lead.findOne({ _id: req.params.id, ...tenant(req), deletedAt: null, isClient: true });
  if (!c) throw notFound("Client not found");
  return c;
}

/** Profile + full journey: lead history, service-stage moves, payments and support tickets in one timeline. */
r.get("/clients/:id", can("clients", "read"), h(async (req, res) => {
  const c = await loadClient(req);
  const [tickets, payments, plans, board] = await Promise.all([
    SupportTicket.find({ companyId: c.companyId, clientId: c._id }).sort({ createdAt: -1 }).limit(100).lean<any[]>(),
    ClientPayment.find({ companyId: c.companyId, clientId: c._id }).sort({ dueDate: -1 }).limit(200).lean<any[]>(),
    ClientPlan.find({ companyId: c.companyId, clientId: c._id }).sort({ createdAt: -1 }).lean<any[]>(),
    getBoard(c.companyId),
  ]);
  const events: any[] = [];
  const first = c.attribution?.[0];
  events.push({ at: c.createdAt, type: "lead", title: "Lead captured", detail: [first?.source || c.source, first?.campaign || c.campaign].filter(Boolean).join(" · ") });
  for (const rm of c.remarks || []) events.push({ at: rm.at, type: rm.statusTo ? "status" : "note", title: rm.statusTo ? `Status → ${rm.statusTo}` : rm.text?.startsWith("Moved to Clients") ? "Became a client" : rm.text?.startsWith("Service status") ? "Service status" : "Note", detail: rm.text, by: rm.by });
  for (const t of tickets) {
    events.push({ at: t.createdAt, type: "ticket", title: `${t.category} ticket ${t.ticketNo} raised`, detail: t.description.slice(0, 200), by: t.via === "portal" ? "Client (support page)" : undefined });
    for (const hst of t.history || []) if (hst.to && hst.from) events.push({ at: hst.at, type: "ticket", title: `Ticket ${t.ticketNo}: ${hst.from} → ${hst.to}`, detail: hst.note, by: hst.by });
  }
  for (const p of payments) {
    events.push({ at: p.createdAt, type: "payment", title: `${p.kind === "recurring" ? "Recurring" : "On-demand"} payment due ${new Date(p.dueDate).toLocaleDateString("en-IN")}`, detail: `₹${p.gross.toLocaleString("en-IN")} · ${p.services.join(", ")}` });
    if (p.paidAt) events.push({ at: p.paidAt, type: "paid", title: "Payment received", detail: `₹${p.gross.toLocaleString("en-IN")}${p.mode ? ` · ${p.mode}` : ""}${p.txnId ? ` · ${p.txnId}` : ""}` });
  }
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const outstanding = payments.filter((p) => p.status !== "paid").reduce((a, p) => a + p.gross, 0);
  const paid = payments.filter((p) => p.status === "paid").reduce((a, p) => a + p.gross, 0);
  res.json({ client: safeLead(c), columns: board.columns, tickets, plans, payments, events, totals: { outstanding: round2(outstanding), paid: round2(paid) } });
}));

const clientEdit = z.object({
  name: z.string().trim().max(150).optional(),
  phone: z.string().optional().or(z.literal("")),
  whatsapp: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(500).optional(),
  services: z.array(z.string().max(80)).max(30).optional(),
  business: businessBody.optional(),
  remark: z.string().max(2000).optional(),
});
r.put("/clients/:id", can("clients", "update"), h(async (req, res) => {
  const b = parse(clientEdit, req.body);
  const c = await loadClient(req);
  const { business, services, remark, ...f } = b;
  if (f.phone) f.phone = normalizePhone(f.phone);
  if (f.whatsapp) f.whatsapp = normalizePhone(f.whatsapp);
  c.set(f);
  if (services) c.services = await assertServices(c.companyId, services);
  applyBusiness(c, business);
  if (remark) c.remarks.push({ by: req.auth!.name, text: remark });
  await c.save();
  res.locals.item = `${c.clientCode} ${c.name}`;
  res.json(safeLead(c));
}));

/* ───────────── Kanban board ───────────── */
r.get("/clients-board", can("clients", "read"), h(async (req, res) => {
  const cid = tenant(req).companyId;
  await promoteClients(cid);
  const board = await getBoard(cid);
  const ids = board.columns.map((c: any) => c.id);
  const per = Math.min(200, Number(req.query.perColumn) || 100);
  const q: any = { companyId: oid(cid), deletedAt: null, isClient: true };
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q)), $options: "i" };
    q.$or = [{ name: rx }, { clientCode: rx }, { phone: rx }];
  }
  // first column also holds clients whose column was deleted or never set
  const stageOf = (i: number) => (i === 0 ? { $nin: ids.slice(1) } : ids[i]);
  // one indexed query per column, in parallel (newest move first), plus counts
  const [cols, grouped] = await Promise.all([
    Promise.all(ids.map((_: string, i: number) => Lead.find({ ...q, serviceStage: stageOf(i) }).sort({ stageAt: -1 }).limit(per).select("name clientCode phone whatsapp services stageAt serviceStage").lean())),
    Lead.aggregate([{ $match: q }, { $group: { _id: "$serviceStage", n: { $sum: 1 } } }]), // one pass for every column's count
  ]);
  const byStage = new Map(grouped.map((g: any) => [g._id, g.n]));
  const all = grouped.reduce((a: number, g: any) => a + g.n, 0);
  const counts = ids.map((id: string, i: number) => (i === 0 ? all - ids.slice(1).reduce((a: number, x: string) => a + (byStage.get(x) || 0), 0) : byStage.get(id) || 0));
  res.json({ columns: board.columns.map((c: any, i: number) => ({ ...c, cards: cols[i], total: counts[i] })) });
}));

const columnsBody = z.object({
  columns: z
    .array(z.object({ id: z.string().max(40).optional(), name: z.string().trim().min(1, "Column name can't be empty").max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }))
    .min(1, "Keep at least one column")
    .max(20),
});
/** Add / rename / delete / reorder columns. Cards in a deleted column move to the first column. */
r.put("/clients-board/columns", can("clients", "update"), h(async (req, res) => {
  const { columns } = parse(columnsBody, req.body);
  const cid = tenant(req).companyId;
  const board = await getBoard(cid);
  const next = columns.map((c) => ({ id: c.id && board.columns.some((x: any) => x.id === c.id) ? c.id : newColumnId(), name: c.name, color: c.color || "#64748b" }));
  const names = next.map((c) => c.name.toLowerCase());
  if (new Set(names).size !== names.length) throw badRequest("Two columns have the same name");
  const removed = board.columns.filter((c: any) => !next.some((n) => n.id === c.id)).map((c: any) => c.id);
  await ClientBoard.updateOne({ companyId: cid }, { $set: { columns: next } });
  if (removed.length) await Lead.updateMany({ companyId: cid, isClient: true, serviceStage: { $in: removed } }, { $set: { serviceStage: next[0].id, stageAt: new Date() } });
  res.locals.item = next.map((c) => c.name).join(" · ");
  res.json({ columns: next, moved: removed.length });
}));

/** Drag-drop: move a client to another column. */
r.patch("/clients/:id/stage", can("clients", "update"), h(async (req, res) => {
  const { stage } = parse(z.object({ stage: z.string().max(40) }), req.body);
  const c = await loadClient(req);
  const board = await getBoard(c.companyId);
  const to = board.columns.find((x: any) => x.id === stage);
  if (!to) throw badRequest("That column no longer exists — refresh the board");
  if (c.serviceStage === stage) return res.json({ ok: true });
  const from = board.columns.find((x: any) => x.id === c.serviceStage)?.name || board.columns[0]?.name;
  c.serviceStage = stage;
  c.stageAt = new Date();
  c.remarks.push({ by: req.auth!.name, text: `Service status: ${from} → ${to.name}` });
  await c.save();
  res.locals.item = `${c.clientCode} → ${to.name}`;
  res.json({ ok: true, stage, stageAt: c.stageAt });
}));

/* ───────────── Support tickets (company side) ───────────── */
export async function notifyTicket(t: any, client: any, event: "support_ticket_created" | "support_ticket_updated", note?: string, by?: string) {
  const phone = clientPhone(client);
  if (!phone) return { sent: 0, reason: "Client has no WhatsApp / phone number" };
  const company = await Company.findById(t.companyId).select("name").lean<any>();
  const message =
    event === "support_ticket_created"
      ? `Hi ${client.name || ""}, we have received your ${t.category.toLowerCase()} request. Ticket ${t.ticketNo} is now Open — we'll keep you posted here.`
      : `Hi ${client.name || ""}, your ticket ${t.ticketNo} is now ${t.status}.${note ? ` ${note}` : ""}`;
  return fireEvent("company", String(t.companyId), event, { phone, name: client.name, company: company?.name, message: message.trim(), params: { ticket_no: t.ticketNo, status: t.status, category: t.category, client_id: client.clientCode, note: note || "" } }, by ? "manual" : "auto", by);
}

r.get("/clients-tickets", can("clients", "read"), h(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const q: any = { ...tenant(req) };
  if (req.query.status) q.status = { $in: String(req.query.status).split(",") };
  if (req.query.category) q.category = String(req.query.category);
  if (req.query.clientId && isId(req.query.clientId)) q.clientId = req.query.clientId;
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q)), $options: "i" };
    q.$or = [{ ticketNo: rx }, { clientCode: rx }, { clientName: rx }, { description: rx }];
  }
  const [items, total, counts] = await Promise.all([
    SupportTicket.find(q).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    SupportTicket.countDocuments(q),
    SupportTicket.aggregate([{ $match: { companyId: oid(tenant(req).companyId) } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  res.json({ items, total, page, limit, counts: Object.fromEntries(counts.map((c: any) => [c._id, c.n])) });
}));

export async function createTicket(client: any, category: string, description: string, via: "portal" | "staff", by?: string) {
  const ticketNo = `T-${String(await nextSeq("ticket")).padStart(6, "0")}`;
  const t = await SupportTicket.create({ companyId: client.companyId, ticketNo, clientId: client._id, clientCode: client.clientCode, clientName: client.name, category, description, via, history: [{ by: by || "Client", to: "Open", note: "Ticket created" }] });
  const n: any = await notifyTicket(t, client, "support_ticket_created").catch(() => ({ sent: 0 }));
  if (n?.sent) await SupportTicket.updateOne({ _id: t._id }, { $set: { "history.0.notified": true } });
  return t;
}

r.post("/clients-tickets", can("clients", "create"), h(async (req, res) => {
  const b = parse(z.object({ clientId: z.string(), category: z.enum(SUPPORT_CATEGORIES), description: z.string().trim().min(5, "Describe the issue").max(4000) }), req.body);
  if (!isId(b.clientId)) throw badRequest("Pick a client");
  const client = await Lead.findOne({ _id: b.clientId, ...tenant(req), deletedAt: null, isClient: true }).lean<any>();
  if (!client) throw notFound("Client not found");
  const t = await createTicket(client, b.category, b.description, "staff", req.auth!.name);
  res.locals.item = t.ticketNo;
  res.status(201).json(t);
}));

/** Status update (with an optional note for the client) → automatic WhatsApp to the client. */
r.patch("/clients-tickets/:id", can("clients", "update"), h(async (req, res) => {
  const b = parse(z.object({ status: z.enum(TICKET_STATUS_LIST), note: z.string().trim().max(500).optional() }), req.body);
  if (!isId(req.params.id)) throw notFound();
  const t = await SupportTicket.findOne({ _id: req.params.id, ...tenant(req) });
  if (!t) throw notFound();
  if (t.status === b.status && !b.note) return res.json({ ticket: t, notified: false });
  const from = t.status;
  t.status = b.status;
  if (["Resolved", "Closed"].includes(b.status)) t.closedAt = new Date();
  const client = await Lead.findById(t.clientId).select("name phone whatsapp business.ownerPhone clientCode").lean<any>();
  const n: any = client ? await notifyTicket(t, client, "support_ticket_updated", b.note, req.auth!.email).catch((e) => ({ sent: 0, reason: e.message })) : { sent: 0, reason: "Client not found" };
  t.history.push({ by: req.auth!.name, from, to: b.status, note: b.note, notified: !!n?.sent });
  await t.save();
  res.locals.item = `${t.ticketNo} ${from} → ${b.status}`;
  res.json({ ticket: t, notified: !!n?.sent, reason: n?.sent ? undefined : n?.reason });
}));

r.delete("/clients-tickets/:id", can("clients", "delete"), h(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const d = await SupportTicket.findOneAndDelete({ _id: req.params.id, ...tenant(req) }).lean<any>();
  if (!d) throw notFound();
  res.locals.item = d.ticketNo;
  res.json({ ok: true });
}));

/* ───────────── Payment Details (plans) ───────────── */
const planBody = z
  .object({
    clientId: z.string(),
    serviceType: z.string().trim().min(1, "Pick a service type").max(80),
    amount: z.coerce.number().min(0, "Amount can't be negative").max(1e9),
    type: z.enum(["recurring", "on_demand"]),
    frequency: z.enum(CLIENT_FREQ_KEYS),
    startDate: z.coerce.date().optional(),
    active: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "recurring" && v.frequency === "on_demand") ctx.addIssue({ code: "custom", path: ["frequency"], message: "Pick how often a recurring payment repeats" });
    if (v.type === "on_demand" && v.frequency !== "on_demand") ctx.addIssue({ code: "custom", path: ["frequency"], message: "On-demand payments use the On-demand frequency" });
  });

async function clientFor(req: Request, id: string) {
  if (!isId(id)) throw badRequest("Pick a client");
  const c = await Lead.findOne({ _id: id, ...tenant(req), deletedAt: null, isClient: true }).select("name clientCode phone whatsapp business.ownerPhone companyId").lean<any>();
  if (!c) throw badRequest("Client not found");
  return c;
}

r.get("/clients-plans", can("clients", "read"), h(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const q: any = { ...tenant(req) };
  if (req.query.type) q.type = req.query.type;
  if (req.query.clientId && isId(req.query.clientId)) q.clientId = req.query.clientId;
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q)), $options: "i" };
    q.$or = [{ clientCode: rx }, { clientName: rx }, { serviceType: rx }];
  }
  const [items, total] = await Promise.all([ClientPlan.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), ClientPlan.countDocuments(q)]);
  res.json({ items, total, page, limit });
}));

r.post("/clients-plans", can("clients", "create"), h(async (req, res) => {
  const b = parse(planBody, req.body);
  const c = await clientFor(req, b.clientId);
  const [svc] = await assertServices(c.companyId, [b.serviceType]);
  const startDate = b.type === "recurring" ? b.startDate || new Date() : undefined;
  const plan = await ClientPlan.create({ ...b, serviceType: svc, startDate, companyId: c.companyId, clientCode: c.clientCode, clientName: c.name });
  if (plan.type === "recurring") await ensureRecurringDues(c.companyId, [plan._id]);
  res.locals.item = `${c.clientCode} · ${svc} · ₹${b.amount}`;
  res.status(201).json(plan);
}));

r.put("/clients-plans/:id", can("clients", "update"), h(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const b = parse(planBody, req.body);
  const plan = await ClientPlan.findOne({ _id: req.params.id, ...tenant(req) });
  if (!plan) throw notFound();
  const c = await clientFor(req, b.clientId);
  const [svc] = await assertServices(c.companyId, [b.serviceType]);
  plan.set({ ...b, serviceType: svc, clientCode: c.clientCode, clientName: c.name, startDate: b.type === "recurring" ? b.startDate || plan.startDate || new Date() : undefined });
  await plan.save();
  // upcoming unpaid dues follow the new amount / service; history is never rewritten
  await ClientPayment.updateMany({ planId: plan._id, status: { $ne: "paid" } }, { $set: { amount: plan.amount, gross: plan.amount, discountAmount: 0, discountValue: 0, services: [svc], clientId: c._id, clientCode: c.clientCode, clientName: c.name } });
  if (plan.type === "recurring" && plan.active) await ensureRecurringDues(c.companyId, [plan._id]);
  else await ClientPayment.deleteMany({ planId: plan._id, status: { $ne: "paid" } });
  res.locals.item = `${c.clientCode} · ${svc}`;
  res.json(plan);
}));

r.delete("/clients-plans/:id", can("clients", "delete"), h(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const d = await ClientPlan.findOneAndDelete({ _id: req.params.id, ...tenant(req) }).lean<any>();
  if (!d) throw notFound();
  const removed = await ClientPayment.deleteMany({ planId: d._id, status: { $ne: "paid" } }); // paid ones stay in history
  res.locals.item = `${d.clientCode} · ${d.serviceType}`;
  res.json({ ok: true, removedDues: removed.deletedCount });
}));

/* ───────────── Payments ───────────── */
const inr = (n: number) => `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtD = (d: any) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

r.get("/clients-payments", can("clients", "read"), h(async (req, res) => {
  const cid = tenant(req).companyId;
  await refreshBilling(cid);
  const { page, limit, skip } = paging(req.query);
  const view = String(req.query.view || "recurring");
  const q: any = { companyId: cid };
  if (view === "history") q.status = "paid";
  else {
    q.kind = view === "on_demand" ? "on_demand" : "recurring";
    q.status = req.query.status ? { $in: String(req.query.status).split(",").filter((s) => s !== "paid") } : { $in: ["unpaid", "overdue"] };
  }
  if (req.query.clientId && isId(req.query.clientId)) q.clientId = req.query.clientId;
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q)), $options: "i" };
    q.$or = [{ clientCode: rx }, { clientName: rx }, { services: rx }, { txnId: rx }];
  }
  const sort: any = view === "history" ? { paidAt: -1 } : { dueDate: 1 };
  const [items, total, sums] = await Promise.all([
    ClientPayment.find(q).sort(sort).skip(skip).limit(limit).lean(),
    ClientPayment.countDocuments(q),
    ClientPayment.aggregate([{ $match: { ...q, companyId: oid(cid), ...(q.clientId ? { clientId: oid(q.clientId) } : {}) } }, { $group: { _id: "$status", n: { $sum: 1 }, amount: { $sum: "$gross" } } }]),
  ]);
  res.json({ items, total, page, limit, sums: Object.fromEntries(sums.map((s: any) => [s._id, { n: s.n, amount: round2(s.amount) }])) });
}));

const paymentBody = z.object({
  clientId: z.string(),
  services: z.array(z.string().max(80)).min(1, "Pick at least one service type").max(30),
  amount: z.coerce.number().min(0).max(1e9),
  discountType: z.enum(["fixed", "percent"]).default("fixed"),
  discountValue: z.coerce.number().min(0).default(0),
  status: z.enum(["unpaid", "overdue", "paid"]).default("unpaid"),
  mode: z.enum(PAYMENT_MODES).optional().nullable(),
  txnId: z.string().trim().max(80).optional(),
  remarks: z.string().trim().max(1000).optional(),
  dueDate: z.coerce.date().optional(),
});

r.post("/clients-payments", can("clients", "create"), h(async (req, res) => {
  const b = parse(paymentBody, req.body);
  const c = await clientFor(req, b.clientId);
  const services = await assertServices(c.companyId, b.services);
  const dType = b.discountType || "fixed";
  const dValue = b.discountValue || 0;
  if (dType === "percent" && dValue > 100) throw badRequest("Discount can't be more than 100%");
  const d = applyDiscount(b.amount, dType, dValue);
  const p = await ClientPayment.create({
    companyId: c.companyId,
    kind: "on_demand",
    clientId: c._id,
    clientCode: c.clientCode,
    clientName: c.name,
    services,
    dueDate: b.dueDate || new Date(),
    amount: round2(b.amount),
    discountType: dType,
    discountValue: dValue,
    discountAmount: d.discountAmount,
    gross: d.gross,
    status: b.status || "unpaid",
    paidAt: b.status === "paid" ? new Date() : undefined,
    mode: b.mode || undefined,
    txnId: b.txnId,
    remarks: b.remarks,
  });
  res.locals.item = `${c.clientCode} · ${inr(p.gross)}`;
  res.status(201).json(p);
}));

/**
 * Edit. History (paid) rows: only the status can change (moving it back to Unpaid / Over-Due returns it to the list).
 * Recurring rows: amount/discount/status/mode/txn/remarks — client and service come from Payment Details.
 */
r.put("/clients-payments/:id", can("clients", "update"), h(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const p = await ClientPayment.findOne({ _id: req.params.id, ...tenant(req) });
  if (!p) throw notFound();
  if (p.status === "paid") {
    const { status } = parse(z.object({ status: z.enum(["unpaid", "overdue", "paid"]) }), req.body);
    if (status !== "paid") {
      p.status = status;
      p.paidAt = undefined;
    }
    await p.save();
    if (status !== "paid") await refreshOverdue(p.companyId);
    res.locals.item = `${p.clientCode} · ${inr(p.gross)} → ${status}`;
    return res.json(p);
  }
  const b = parse(paymentBody.partial(), req.body);
  if (p.kind === "on_demand") {
    if (b.clientId && String(b.clientId) !== String(p.clientId)) {
      const c = await clientFor(req, b.clientId);
      p.set({ clientId: c._id, clientCode: c.clientCode, clientName: c.name });
    }
    if (b.services) p.services = await assertServices(p.companyId, b.services);
    if (b.dueDate) p.dueDate = b.dueDate;
  }
  if (b.amount !== undefined) p.amount = round2(b.amount);
  if (b.discountType) p.discountType = b.discountType;
  if (b.discountValue !== undefined) p.discountValue = b.discountValue;
  if (p.discountType === "percent" && p.discountValue > 100) throw badRequest("Discount can't be more than 100%");
  const d = applyDiscount(p.amount, p.discountType, p.discountValue);
  p.discountAmount = d.discountAmount;
  p.gross = d.gross;
  if (b.mode !== undefined) p.mode = b.mode || undefined;
  if (b.txnId !== undefined) p.txnId = b.txnId;
  if (b.remarks !== undefined) p.remarks = b.remarks;
  if (b.status) {
    p.status = b.status;
    if (b.status === "paid") p.paidAt = new Date();
  }
  await p.save();
  if (p.status === "paid" && p.kind === "recurring" && p.planId) await ensureRecurringDues(p.companyId, [p.planId]); // next period appears
  res.locals.item = `${p.clientCode} · ${inr(p.gross)} · ${p.status}`;
  res.json(p);
}));

r.delete("/clients-payments/:id", can("clients", "delete"), h(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const d = await ClientPayment.findOneAndDelete({ _id: req.params.id, ...tenant(req) }).lean<any>();
  if (!d) throw notFound();
  res.locals.item = `${d.clientCode} · ${inr(d.gross)}`;
  res.json({ ok: true });
}));

/* ───────────── Reminders (WhatsApp) ───────────── */
async function sendPaymentReminder(req: Request, client: any, message: string, params: Record<string, any>) {
  const phone = clientPhone(client);
  if (!phone) throw badRequest("This client has no WhatsApp / phone number");
  const company = await Company.findById(client.companyId).select("name").lean<any>();
  const r2: any = await fireEvent("company", String(client.companyId), "client_payment_reminder", { phone, name: client.name, company: company?.name, message, params: { client_id: client.clientCode, ...params } }, "manual", req.auth!.email);
  if (!r2.sent) throw new HttpError(424, `${r2.reason || "WhatsApp not sent"}. Create an active webhook for "Client payment reminder" in Settings › WhatsApp Webhook.`);
  return r2;
}

r.post("/clients-payments/:id/reminder", can("clients", "update"), h(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const p = await ClientPayment.findOne({ _id: req.params.id, ...tenant(req) });
  if (!p) throw notFound();
  const client = await Lead.findById(p.clientId).select("name phone whatsapp business.ownerPhone clientCode companyId").lean<any>();
  if (!client) throw notFound("Client not found");
  const message =
    p.status === "paid"
      ? `Hi ${client.name || ""}, thank you — we have received ${inr(p.gross)} for ${p.services.join(", ")}${p.txnId ? ` (ref ${p.txnId})` : ""}.`
      : `Hi ${client.name || ""}, a gentle reminder: ${inr(p.gross)} for ${p.services.join(", ")} ${p.status === "overdue" ? "was" : "is"} due on ${fmtD(p.dueDate)}.`;
  const r2 = await sendPaymentReminder(req, client, message.trim(), { amount: p.gross, due_date: fmtD(p.dueDate), status: p.status, services: p.services.join(", ") });
  p.lastReminderAt = new Date();
  await p.save();
  res.locals.action = "Reminder";
  res.locals.item = `${p.clientCode} · ${inr(p.gross)}`;
  res.json({ ok: true, sent: r2.sent });
}));

r.post("/clients-plans/:id/reminder", can("clients", "update"), h(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const plan = await ClientPlan.findOne({ _id: req.params.id, ...tenant(req) });
  if (!plan) throw notFound();
  const client = await Lead.findById(plan.clientId).select("name phone whatsapp business.ownerPhone clientCode companyId").lean<any>();
  if (!client) throw notFound("Client not found");
  const next = plan.type === "recurring" ? await ClientPayment.findOne({ planId: plan._id, status: { $ne: "paid" } }).sort({ dueDate: 1 }).lean<any>() : null;
  const message = `Hi ${client.name || ""}, your ${plan.serviceType} plan: ${inr(plan.amount)} (${clientFreqLabel(plan.frequency)})${next ? ` — next payment due ${fmtD(next.dueDate)}` : ""}.`;
  const r2 = await sendPaymentReminder(req, client, message, { amount: plan.amount, frequency: clientFreqLabel(plan.frequency), service: plan.serviceType, due_date: next ? fmtD(next.dueDate) : "" });
  plan.lastReminderAt = new Date();
  await plan.save();
  res.locals.action = "Reminder";
  res.locals.item = `${plan.clientCode} · ${plan.serviceType}`;
  res.json({ ok: true, sent: r2.sent });
}));

export default r;

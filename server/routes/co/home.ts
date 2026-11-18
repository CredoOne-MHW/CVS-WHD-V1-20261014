/**
 * What the phone's home screen shows, and a customer's own support tickets.
 *
 * Two reasons this is its own file rather than more endpoints bolted onto the others.
 *
 * **One request.** A phone on a patchy connection should not make five calls to fill one screen. Everything
 * the dashboard draws arrives together, computed in parallel here, so the screen is either there or not —
 * never half-filled with four spinners.
 *
 * **Customers see only themselves.** A customer sign-in is tied to the client record they already are
 * (v1.9.0). Every query below is scoped by that id rather than by a permission, because a permission that
 * said "may read tickets" would let one customer read another's. Staff never reach the customer branch and
 * customers never reach the staff one.
 */
import { Router } from "express";
import { z } from "zod";
import { SupportTicket, ChatThread, Lead } from "../../models";
import { can, tenant } from "../../middleware/auth";
import { h, parse, notFound, badRequest, forbidden, paging } from "../../lib/http";
import { overview } from "../../lib/insights";
import { SUPPORT_CATEGORIES } from "../../../shared/clients";
import { createTicket } from "./clients";

const r = Router();

/** The client a customer sign-in belongs to, or a refusal. Staff have none and must not reach this. */
async function myClient(req: any) {
  if (req.auth?.kind !== "customer") throw forbidden("This is for customer sign-ins");
  const id = req.auth.clientId || req.auth.leadId;
  if (!id) throw badRequest("This sign-in is not linked to a client yet. Ask your contact to link it.");
  const c = await Lead.findOne({ _id: id, ...tenant(req), deletedAt: null }).lean<any>();
  if (!c) throw notFound("That client record is no longer here");
  return c;
}

/**
 * Chat figures for one person: the groups they are in, and how many conversations are waiting on them.
 *
 * Counted from their own membership rather than from the company's totals — "12 unread" is only useful if
 * the twelve are addressed to the person reading it.
 */
async function chatStats(companyId: string, userId: string) {
  const threads = await ChatThread.find({ companyId, "members.userId": userId })
    .select("kind members unread lastMessage")
    .lean<any[]>()
    .catch(() => []);
  let pending = 0;
  for (const t of threads) {
    const mine = (t.members || []).find((m: any) => String(m.userId) === String(userId));
    pending += Number(mine?.unread || 0);
  }
  return {
    groups: threads.filter((t) => t.kind === "group").length,
    conversations: threads.length,
    pending,
    waiting: threads.filter((t) => {
      const mine = (t.members || []).find((m: any) => String(m.userId) === String(userId));
      return Number(mine?.unread || 0) > 0;
    }).length,
  };
}

/**
 * The staff home screen.
 *
 * Everything comes from one pass of the insights the web dashboard already uses, so the two can never
 * disagree about how many leads there are — a phone showing a different number from the desk is worse than
 * a phone showing none.
 */
r.get("/home/staff", can("dashboard", "read"), h(async (req, res) => {
  const [o, chat] = await Promise.all([
    overview(req.auth!.companyId!, 30).catch(() => null as any),
    chatStats(req.auth!.companyId!, req.auth!.userId),
  ]);
  if (!o) throw badRequest("Those figures could not be worked out just now");

  res.json({
    days: o.days,
    generatedAt: o.generatedAt,
    leads: { total: o.leads?.total || 0, won: o.leads?.won || 0, today: o.leads?.today || 0, change: o.leads?.change ?? null },
    followups: { dueToday: o.followups?.dueToday || 0, overdue: o.followups?.overdue || 0 },
    clients: { total: o.clients?.total || 0, new: o.clients?.new || 0 },
    /** Open leads broken down by where they have got to — the "current lead status" on the screen. */
    pipeline: o.pipeline || { open: 0, byStatus: [] },
    /** How quickly things are being picked up: untouched leads, and how long tickets take to resolve. */
    speed: {
      uncontacted24h: o.speed?.uncontacted24h || 0,
      oldestNewHours: o.speed?.oldestNewHours || 0,
      avgResolutionHours: o.support?.avgResolutionHours ?? null,
    },
    support: o.support || { open: 0, stale48h: 0, grievances: 0, resolved: 0, avgResolutionHours: null },
    chat,
  });
}));

/** The customer home screen: their tickets, and nothing about anybody else. */
r.get("/home/customer", h(async (req, res) => {
  const client = await myClient(req);
  const rows = await SupportTicket.find({ ...tenant(req), clientId: client._id }).select("status category updatedAt").lean<any[]>();
  const by = (s: string) => rows.filter((t) => t.status === s).length;
  const openish = rows.filter((t) => !["Resolved", "Closed"].includes(t.status));
  res.json({
    client: { name: client.name, code: client.clientCode || null, since: client.clientSince || null },
    tickets: {
      total: rows.length,
      open: by("Open"),
      inProgress: by("In Progress"),
      resolved: by("Resolved"),
      closed: by("Closed"),
      /** What is still waiting on the company — the one number a customer actually wants. */
      awaiting: openish.length,
      lastUpdate: rows.length ? rows.map((t) => t.updatedAt).sort().slice(-1)[0] : null,
    },
    categories: SUPPORT_CATEGORIES,
  });
}));

/**
 * A customer's own tickets, newest first.
 *
 * Scoped to their client id, never to a permission — see the note at the top of this file.
 */
r.get("/my-tickets", h(async (req, res) => {
  const client = await myClient(req);
  const { page, limit, skip } = paging(req.query);
  const q: any = { ...tenant(req), clientId: client._id };
  if (req.query.status) q.status = { $in: String(req.query.status).split(",") };
  const [items, total] = await Promise.all([
    SupportTicket.find(q).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    SupportTicket.countDocuments(q),
  ]);
  res.json({ items, total, page, limit });
}));

/** Raising one. The client is taken from the sign-in, never from the request — nobody files under another. */
r.post("/my-tickets", h(async (req, res) => {
  const client = await myClient(req);
  const b = parse(
    z.object({ category: z.enum(SUPPORT_CATEGORIES), description: z.string().trim().min(5, "Describe the issue in a little more detail").max(4000) }),
    req.body
  );
  const t = await createTicket(client, b.category, b.description, "portal", req.auth!.name);
  res.locals.action = "Raise support ticket";
  res.locals.item = t.ticketNo;
  res.status(201).json(t);
}));

export default r;

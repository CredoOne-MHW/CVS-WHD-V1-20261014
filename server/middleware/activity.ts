import type { Request, Response, NextFunction } from "express";
import { ActivityLog } from "../models";

const REDACT = /pass(word)?|secret|token|otp|apikey|api_key|authorization/i;

export function redact(v: any, depth = 0): any {
  if (depth > 5 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) o[k] = REDACT.test(k) ? "••••" : redact(val, depth + 1);
    return o;
  }
  if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + "…";
  return v;
}

const VERB: Record<string, string> = { POST: "Create", PUT: "Update", PATCH: "Update", DELETE: "Delete", GET: "Read" };

/**
 * Logs every mutating API call (and explicit reads flagged with res.locals.logRead)
 * with: Time · User · Action · Module · Item · Response · Error status · Payload.
 */
export function activityLogger(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    const a = req.auth;
    if (!a) return;
    if (req.method === "GET" && !res.locals.logRead) return;
    ActivityLog.create({
      scope: a.scope,
      companyId: a.companyId,
      userId: a.userId,
      userLabel: `${a.name} <${a.email}>`,
      impersonatedBy: a.impersonatedBy,
      action: res.locals.action || VERB[req.method] || req.method,
      module: res.locals.module || req.path.split("/")[2] || "-",
      item: res.locals.item || req.params?.id || "",
      response: res.statusCode,
      error: res.statusCode >= 400 ? res.locals.error || "error" : undefined,
      payload: redact({ body: req.body, query: req.query }),
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress,
    }).catch((e) => console.error("activity log failed", e));
  });
  next();
}

/** For events that happen outside a request (login, cron, intake). */
export function logActivity(entry: Record<string, any>) {
  return ActivityLog.create({ ...entry, payload: redact(entry.payload) }).catch(() => undefined);
}

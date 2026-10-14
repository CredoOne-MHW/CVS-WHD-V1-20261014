import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, type ZodSchema } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const forbidden = (m = "Forbidden") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);

/** Wrap async handlers so thrown errors reach the error middleware. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : err instanceof ZodError ? 400 : err?.code === 11000 ? 409 : 500;
  const message =
    err?.code === 11000 ? `Duplicate value for ${Object.keys(err.keyPattern || {}).join(", ")}` : status === 500 ? "Internal server error" : err.message;
  if (status === 500) console.error(err);
  res.locals.error = err?.message;
  res.status(status).json({ error: message, details: err?.details });
}

export function paging(q: any) {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

export function dateRange(q: any, field = "createdAt") {
  const f: any = {};
  if (q.from) f.$gte = new Date(q.from);
  if (q.to) {
    const t = new Date(q.to);
    t.setHours(23, 59, 59, 999);
    f.$lte = t;
  }
  return Object.keys(f).length ? { [field]: f } : {};
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

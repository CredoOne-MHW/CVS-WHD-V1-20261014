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

/**
 * Errors that are not ours but are the user's to fix.
 *
 * An upload that is too large, or an S3 bucket that refuses us, is not an internal fault — it is a thing
 * somebody can do something about. Left untranslated, every one of them came back as "Internal server error
 * (ref …)", which tells the person nothing and sends them to us to read a log. Each one here is turned into
 * the sentence that says what to do.
 */
function known(err: any): { status: number; message: string } | null {
  // multer, on an upload that breaks one of its limits
  if (err?.name === "MulterError") {
    const mb = (n?: number) => (n ? `${Math.round(n / 1024 / 1024)} MB` : "the limit");
    const map: Record<string, string> = {
      LIMIT_FILE_SIZE: `Exceeded File Size — the most this accepts is ${mb(err.limit)}. Save it smaller and try again.`,
      LIMIT_FILE_COUNT: "Too many files at once.",
      LIMIT_UNEXPECTED_FILE: `This expects the file under “${err.field || "file"}”. If you are using the normal screen, this is a fault worth reporting.`,
      LIMIT_PART_COUNT: "Too many parts in that upload.",
      LIMIT_FIELD_VALUE: "One of the fields in that upload is too long.",
    };
    return { status: 400, message: map[err.code] || `That upload was refused (${err.code}).` };
  }

  // the AWS SDK, when the bucket or the credentials are not what the platform thinks they are
  const aws = err?.name || err?.Code;
  if (err?.$metadata || ["CredentialsProviderError", "NoSuchBucket", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken", "RequestTimeTooSkewed"].includes(aws)) {
    const map: Record<string, string> = {
      NoSuchBucket: "The S3 bucket named in S3_BUCKET does not exist. Check the name and the region.",
      AccessDenied: "S3 refused the write. The access key needs s3:PutObject on this bucket and prefix.",
      InvalidAccessKeyId: "S3 does not recognise AWS_ACCESS_KEY_ID.",
      SignatureDoesNotMatch: "S3 rejected the signature — AWS_SECRET_ACCESS_KEY does not match the key id.",
      ExpiredToken: "The AWS credentials have expired.",
      CredentialsProviderError: "No AWS credentials are set, so nothing can be stored. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
      RequestTimeTooSkewed: "S3 rejected the request because this server's clock is out of step.",
    };
    if (map[aws]) return { status: 502, message: `File storage: ${map[aws]}` };
    if (err?.$metadata?.httpStatusCode) return { status: 502, message: `File storage refused this (${aws || err.$metadata.httpStatusCode}). ${err.message || ""}`.trim() };
  }
  return null;
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const k = known(err);
  const status = k ? k.status : err instanceof HttpError ? err.status : err instanceof ZodError ? 400 : err?.code === 11000 ? 409 : 500;
  const message = k
    ? k.message
    : err?.code === 11000
      ? `Duplicate value for ${Object.keys(err.keyPattern || {}).join(", ")}`
      : status === 500
        ? "Internal server error"
        : err.message;
  const requestId = (req as any).requestId;
  if (status === 500) console.error(`[${requestId}]`, err); // the id is shown to the user, so support can find this line
  res.locals.error = err?.message;
  res.status(status).json({ error: status === 500 && requestId ? `${message} (ref ${String(requestId).slice(-12)})` : message, details: err?.details, requestId });
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

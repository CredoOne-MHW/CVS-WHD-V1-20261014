import { AsyncLocalStorage } from "async_hooks";

/**
 * Per-request context (one object per request, opened by hostContext()).
 * `db` = the company database this request may touch; null/undefined = the platform (main) database.
 * Kept in its own module so models can read it without importing anything else.
 */
export interface Ctx {
  host?: string;
  base?: string;
  baseSource?: "env" | "auto";
  db?: string | null;
}
export const als = new AsyncLocalStorage<Ctx>();
export const ctx = () => als.getStore();
export const currentDb = () => als.getStore()?.db || null;

/** Binds the rest of this request to a company database (set once auth knows the company). */
export function setTenantDb(db: string | null) {
  const s = als.getStore();
  if (s) s.db = db;
}

/** Run `fn` against a company database (or the main one when db is null), without changing the caller's context. */
export function runInDb<T>(db: string | null, fn: () => T): T {
  return als.run({ ...(als.getStore() || {}), db }, fn);
}
export const runInMain = <T>(fn: () => T): T => runInDb(null, fn);

/**
 * Wrap a callback-style middleware (e.g. multer) so the rest of the request keeps its context. Multer finishes in a
 * stream callback outside the request's async context — without this, writes after an upload would land in the main
 * database instead of the company's own one.
 */
export function keepCtx<Req, Res>(mw: (req: Req, res: Res, next: (err?: any) => void) => void) {
  return (req: Req, res: Res, next: (err?: any) => void) => {
    const store = als.getStore();
    mw(req, res, (err?: any) => (store ? als.run(store, () => next(err)) : next(err)));
  };
}

/** A multer instance whose .single/.array keep the request context (see keepCtx). */
export function ctxUpload<M extends { single: (n: string) => any; array: (n: string, c?: number) => any }>(m: M) {
  return { single: (n: string) => keepCtx(m.single(n)), array: (n: string, c?: number) => keepCtx(m.array(n, c)) };
}

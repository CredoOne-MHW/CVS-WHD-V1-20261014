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

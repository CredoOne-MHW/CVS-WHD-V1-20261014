import type { EventKey } from "../../shared/events";
import mongoose from "mongoose";
import { Webhook, WaLog } from "../models";
import { hostOf, openUntil, record, retryable } from "./circuit";
import { backoffMs, defineJob } from "./jobs";
import { runInDb } from "./context";
import { dbOf } from "./tenantdb";
import { decrypt } from "./crypto";
import { normalizePhone } from "../../shared/constants";
import { buildPayloads, type SendContext } from "../../shared/templating";

export { renderTemplate, toSingleLine, splitMessage, buildPayloads } from "../../shared/templating";
export type { SendContext };

async function httpSend(hook: any, body: any, idemKey?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // the same message always carries the same key (first try, quick retries and later redelivery), so a provider that
  // supports idempotency never sends it twice
  if (idemKey) headers["Idempotency-Key"] = idemKey;
  const extra = decrypt(hook.headersEnc);
  if (extra) Object.assign(headers, JSON.parse(extra));
  const method = hook.method || "POST";
  let url = hook.url;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(15000) };
  if (method === "GET") url += (url.includes("?") ? "&" : "?") + new URLSearchParams({ payload: JSON.stringify(body) });
  else init.body = JSON.stringify(body);
  const r = await fetch(url, init);
  const text = await r.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { ok: r.ok, status: r.status, response: json };
}

/**
 * Quick retries for 5xx / 429 / network errors with exponential backoff + jitter (≈0.5 s, 1.5 s); other 4xx are final.
 * Honours the provider's circuit breaker: while it is open the call is not made at all (deferredUntil is returned and the
 * message is queued for redelivery instead).
 */
async function sendWithRetry(hook: any, body: any, tries = 3, idemKey?: string): Promise<{ ok: boolean; status: number; response: any; attempts: number; deferredUntil?: number }> {
  const host = hostOf(hook.url);
  const until = await openUntil(host);
  if (until) return { ok: false, status: 0, response: { error: `Provider ${host} is unavailable — paused until ${new Date(until).toISOString()}` }, attempts: 0, deferredUntil: until };
  let last: any;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await httpSend(hook, body, idemKey);
      if (r.ok || !retryable(r.status)) {
        await record(host, true);
        return { ...r, attempts: i };
      }
      last = r;
    } catch (e: any) {
      last = { ok: false, status: 0, response: { error: e?.message || String(e) } };
    }
    await record(host, false, last?.response?.error || `HTTP ${last?.status}`);
    if (i < tries) await new Promise((res) => setTimeout(res, 500 * 3 ** (i - 1) * (0.8 + Math.random() * 0.4)));
  }
  return { ...last, attempts: tries };
}

/** Triggers whose failed messages are redelivered automatically (a test or a manual resend reports straight back). */
const REDELIVER_TRIGGERS = new Set(["auto", "manual", "cron", "bulk"]);
const REDELIVER_MAX = 8; // ≈ 30 s, 2 m, 8 m, 32 m, 2 h, 6 h, 6 h → ~15 h before a message is dead-lettered

export interface DispatchOpts {
  scope: "super" | "company";
  companyId?: string;
  trigger: "manual" | "bulk" | "auto" | "test" | "resend" | "cron";
  triggeredBy?: string;
}

/** Sends through one webhook, logs every part to WhatsApp Logs. */
/** Triggers that also copy the message to the webhook's additional numbers (not bulk posts, tests or resends). */
const COPY_TRIGGERS = new Set(["auto", "manual", "cron"]);

export async function dispatch(hook: any, ctx: SendContext, opts: DispatchOpts) {
  const results = await sendTo(hook, ctx, opts);
  // the same message to every additional number on this webhook — logged one by one; the caller's result (e.g. "client
  // notified") reflects only the main recipient
  if (COPY_TRIGGERS.has(opts.trigger)) {
    const main = normalizePhone(ctx.phone);
    for (const n of (hook.extraNumbers || []) as string[]) {
      if (n && n !== main) await sendTo(hook, { ...ctx, phone: n }, opts, `Copy (additional number) of message to ${main || "recipient"} · `).catch(() => undefined);
    }
  }
  return results;
}

async function sendTo(hook: any, ctx: SendContext, opts: DispatchOpts, detailPrefix = "") {
  const results = [];
  for (const p of buildPayloads(hook, ctx)) {
    const logId = new mongoose.Types.ObjectId();
    const r = await sendWithRetry(hook, p.body, 3, String(logId));
    const willRetry = !r.ok && retryable(r.status) && REDELIVER_TRIGGERS.has(opts.trigger);
    const nextAt = willRetry ? new Date(r.deferredUntil || Date.now() + backoffMs(1)) : undefined;
    const log = await WaLog.create({
      _id: logId,
      scope: opts.scope,
      companyId: opts.companyId,
      webhookId: hook._id,
      event: hook.event,
      trigger: opts.trigger,
      to: normalizePhone(ctx.phone),
      name: ctx.name,
      result: r.ok ? "success" : "failed",
      httpStatus: r.status,
      detail: detailPrefix + (r.ok ? `HTTP ${r.status}` : `${r.deferredUntil ? "Provider unavailable" : `HTTP ${r.status || "network"}`} – ${JSON.stringify(r.response).slice(0, 300)}${willRetry ? " · queued for automatic retry" : ""}`),
      part: p.part,
      attempts: r.attempts,
      request: { url: hook.url, method: hook.method, body: p.body },
      response: r.response,
      triggeredBy: opts.triggeredBy,
      ...(willRetry ? { retry: { status: "scheduled", attempts: 0, nextAt } } : {}),
    });
    if (willRetry) {
      const { enqueue } = await import("./jobs");
      await enqueue("wa.redeliver", { logId: String(logId) }, { companyId: opts.scope === "company" ? opts.companyId : undefined, idemKey: `wa:${logId}`, runAt: nextAt, maxAttempts: REDELIVER_MAX }).catch(() => undefined);
    }
    results.push({ ok: r.ok, status: r.status, logId: log._id, part: p.part, queued: willRetry });
  }
  return results;
}

/** Fire every active webhook bound to an event (system events like lead_created). */
/** Fire a registered event (shared/events.ts) — unregistered keys don't compile. */
export async function fireEvent<S extends "super" | "company">(scope: S, companyId: string | undefined, event: EventKey<S>, ctx: SendContext, trigger: DispatchOpts["trigger"] = "auto", triggeredBy?: string) {
  // platform webhooks/logs live in the main database, company ones in the company's database
  const db = scope === "company" && companyId ? await dbOf(companyId) : null;
  return runInDb(db, () => fireEventHere(scope, companyId, event, ctx, trigger, triggeredBy));
}
async function fireEventHere(scope: "super" | "company", companyId: string | undefined, event: string, ctx: SendContext, trigger: DispatchOpts["trigger"], triggeredBy?: string) {
  const hooks = await Webhook.find({ scope, ...(companyId ? { companyId } : {}), event, active: true }).lean();
  if (!hooks.length) return { sent: 0, results: [], reason: `No active webhook for event "${event}"` };
  const results = [];
  for (const hook of hooks) results.push(...(await dispatch(hook, ctx, { scope, companyId, trigger, triggeredBy })));
  return { sent: results.filter((r) => r.ok).length, results };
}

/** Resend exactly the logged body to the same webhook. */
export async function resendLog(log: any, by?: string) {
  const hook = await Webhook.findById(log.webhookId).lean();
  if (!hook) throw new Error("Webhook no longer exists");
  const r = await sendWithRetry(hook, log.request?.body, 3, String(log._id));
  return WaLog.create({
    ...log,
    _id: undefined,
    createdAt: undefined,
    trigger: "resend",
    result: r.ok ? "success" : "failed",
    httpStatus: r.status,
    detail: r.ok ? `Resent · HTTP ${r.status}` : `Resend failed · HTTP ${r.status}`,
    response: r.response,
    attempts: r.attempts,
    triggeredBy: by,
  });
}

/**
 * Redelivery of a message that failed because the provider was down (network / 5xx / 429 / open circuit).
 * Runs in the background with exponential backoff; the original WhatsApp Logs row is updated in place (same
 * Idempotency-Key every time). After the last attempt the message is dead-lettered: the log shows it, and it can be
 * replayed from Super Admin › System Health or resent from WhatsApp Logs.
 */
defineJob(
  "wa.redeliver",
  async (p, _st, ctx) => {
    const log = await WaLog.findById(p.logId).lean<any>();
    if (!log || log.result === "success") return { done: true, result: { skipped: true } };
    const hook = await Webhook.findById(log.webhookId).lean<any>();
    if (!hook || !hook.active) {
      await WaLog.updateOne({ _id: log._id }, { $set: { "retry.status": "dead", "retry.lastError": "Webhook deleted or switched off" } });
      return { done: true, result: { skipped: "webhook gone" } };
    }
    const attempt = (ctx.job.attempts || 0) + 1;
    const r = await sendWithRetry(hook, log.request?.body, 1, String(log._id));
    if (r.ok) {
      await WaLog.updateOne({ _id: log._id }, { $set: { result: "success", httpStatus: r.status, response: r.response, detail: `Delivered on automatic retry #${attempt} · HTTP ${r.status}`, "retry.status": "delivered", "retry.attempts": attempt }, $inc: { attempts: 1 } });
      return { done: true, result: { delivered: true, attempt } };
    }
    const final = attempt >= (ctx.job.maxAttempts || REDELIVER_MAX) || !retryable(r.status);
    const err = r.deferredUntil ? "provider unavailable (circuit open)" : `HTTP ${r.status || "network"}`;
    await WaLog.updateOne(
      { _id: log._id },
      {
        $set: final
          ? { httpStatus: r.status, response: r.response, detail: `Not delivered after ${attempt} automatic retries (${err}) — dead-lettered. Use Resend once the provider is back.`, "retry.status": "dead", "retry.attempts": attempt, "retry.lastError": err }
          : { "retry.attempts": attempt, "retry.lastError": err, "retry.nextAt": new Date(r.deferredUntil || Date.now() + backoffMs(attempt + 1)) },
        $inc: { attempts: Math.max(1, r.attempts) },
      }
    );
    if (!retryable(r.status)) return { done: true, result: { delivered: false, final: err } }; // a 4xx won't fix itself
    throw new Error(err); // → backoff (or dead-letter after the last attempt)
  },
  { maxAttempts: REDELIVER_MAX }
);

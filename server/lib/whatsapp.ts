import { Webhook, WaLog } from "../models";
import { runInDb } from "./context";
import { dbOf } from "./tenantdb";
import { decrypt } from "./crypto";
import { normalizePhone } from "../../shared/constants";
import { buildPayloads, type SendContext } from "../../shared/templating";

export { renderTemplate, toSingleLine, splitMessage, buildPayloads } from "../../shared/templating";
export type { SendContext };

async function httpSend(hook: any, body: any) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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

/** Retry 5xx / network errors with backoff (0.5s, 1.5s). 4xx is final. */
async function sendWithRetry(hook: any, body: any, tries = 3) {
  let last: any;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await httpSend(hook, body);
      if (r.ok || (r.status >= 400 && r.status < 500)) return { ...r, attempts: i };
      last = r;
    } catch (e: any) {
      last = { ok: false, status: 0, response: { error: e?.message || String(e) } };
    }
    if (i < tries) await new Promise((res) => setTimeout(res, 500 * 3 ** (i - 1)));
  }
  return { ...last, attempts: tries };
}

export interface DispatchOpts {
  scope: "super" | "company";
  companyId?: string;
  trigger: "manual" | "bulk" | "auto" | "test" | "resend" | "cron";
  triggeredBy?: string;
}

/** Sends through one webhook, logs every part to WhatsApp Logs. */
export async function dispatch(hook: any, ctx: SendContext, opts: DispatchOpts) {
  const results = [];
  for (const p of buildPayloads(hook, ctx)) {
    const r = await sendWithRetry(hook, p.body);
    const log = await WaLog.create({
      scope: opts.scope,
      companyId: opts.companyId,
      webhookId: hook._id,
      event: hook.event,
      trigger: opts.trigger,
      to: normalizePhone(ctx.phone),
      name: ctx.name,
      result: r.ok ? "success" : "failed",
      httpStatus: r.status,
      detail: r.ok ? `HTTP ${r.status}` : `HTTP ${r.status || "network"} – ${JSON.stringify(r.response).slice(0, 300)}`,
      part: p.part,
      attempts: r.attempts,
      request: { url: hook.url, method: hook.method, body: p.body },
      response: r.response,
      triggeredBy: opts.triggeredBy,
    });
    results.push({ ok: r.ok, status: r.status, logId: log._id, part: p.part });
  }
  return results;
}

/** Fire every active webhook bound to an event (system events like lead_created). */
export async function fireEvent(scope: "super" | "company", companyId: string | undefined, event: string, ctx: SendContext, trigger: DispatchOpts["trigger"] = "auto", triggeredBy?: string) {
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
  const r = await sendWithRetry(hook, log.request?.body);
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

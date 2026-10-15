import { AiAgent, AiAllocation, CompanyAgent } from "../models";
import { runInDb } from "./context";
import { dbOf } from "./tenantdb";
import { toText } from "../../shared/text";
import { complete, knowledge, agentSystem, parseJson, type Msg } from "./ai";
import { runReport, schemaForPrompt, specSchema } from "./reports";
import { HttpError } from "./http";
import type { AuthCtx } from "../middleware/auth";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const SPEC_RULES = (a: AuthCtx) => `You can read the company's data ONLY through report specs (read-only; you can never create, change or delete anything).
Datasets and fields:
${schemaForPrompt(a)}

A spec is JSON:
{"dataset": "<key>", "title": "...", "columns": ["field", ...], "filters": [{"field": "...", "op": "eq|ne|in|nin|contains|gt|gte|lt|lte|exists", "value": ...}],
 "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "groupBy": ["field" or "dateField:day|week|month|year"], "metrics": [{"op": "count|sum|avg|min|max", "field": "numberField"}],
 "sort": {"field": "...", "dir": "asc|desc"}, "limit": 1-500}
Use groupBy + metrics for totals, trends and breakdowns; use columns for lists. Today is ${today()} (India time).`;

async function loadAgent(companyId: string, companyAgentId?: string, assistant = false) {
  const ca = await CompanyAgent.findOne({ companyId, active: true, ...(assistant ? { isAssistant: true } : { _id: companyAgentId }) }).lean<any>();
  if (!ca) throw new HttpError(assistant ? 404 : 400, assistant ? "No AI assistant is enabled for this company" : "Select an AI agent");
  if (!ca.agentId) throw new HttpError(400, `“${ca.name}” has no AI model yet. Ask your Super Admin to allocate an AI model with credits, then pick it in Settings › AI Agent.`);
  const agent = await AiAgent.findOne({ _id: ca.agentId, active: true }).lean<any>();
  if (!agent) throw new HttpError(400, "The AI model behind this agent is unavailable");
  return { ca, agent };
}

/** Agentic report: the AI turns a plain-English request into a spec, we run it read-only, the AI summarises. */
export async function agenticReport(a: AuthCtx, companyAgentId: string, prompt: string) {
  const { ca, agent } = await loadAgent(a.companyId!, companyAgentId);
  return withAgentDb(a.companyId!, agent._id, () => agenticReportIn(a, ca, agent, prompt));
}
async function agenticReportIn(a: AuthCtx, ca: any, agent: any, prompt: string) {
  const system = agentSystem(ca, "", `You build reports and dashboards for ${a.companyName}.\n${SPEC_RULES(a)}\nReply with ONLY a JSON object: {"spec": <spec>, "chart": "bar|line|table|kpi", "explanation": "one sentence on what the report shows"}.`);
  const first = await complete({ agent, companyId: a.companyId!, system, messages: [{ role: "user", content: prompt }], purpose: "report", userId: a.userId, companyAgentId: ca._id, json: true, maxTokens: 800 });
  const plan = parseJson(first.text);
  const parsed = specSchema.safeParse(plan?.spec);
  if (!parsed.success) throw new HttpError(422, "The AI couldn't turn that into a report. Try naming what to count and over which period, e.g. “leads per source this month”.");
  const report = await runReport(a, { ...parsed.data, limit: Math.min(parsed.data.limit || 200, 500) });

  // short written insight over the result (top rows only)
  const sample = JSON.stringify(report.rows.slice(0, 40));
  const second = await complete({
    agent,
    companyId: a.companyId!,
    system: "You are a sharp sales analyst. Write 2–4 short bullet insights (plain text, start each with •) from the data. Mention concrete numbers. No preamble.",
    messages: [{ role: "user", content: `Request: ${prompt}\nReport: ${report.title}\nColumns: ${report.columns.map((c) => c.label).join(", ")}\nRows: ${sample}` }],
    purpose: "report",
    userId: a.userId,
    companyAgentId: ca._id,
    maxTokens: 350,
  }).catch(() => ({ text: "", usage: first.usage }));

  return { ...report, chart: ["bar", "line", "table", "kpi"].includes(plan.chart) ? plan.chart : "table", explanation: plan.explanation || "", insights: second.text, usage: second.usage };
}

/**
 * Floating assistant. Read-only by construction: the only data tool it has is the report engine,
 * which executes whitelisted aggregations scoped to the user's company AND the user's module permissions.
 */
/** The assistant must always hand the browser a plain string, whatever shape the model replied in. */
function answerText(j: any, raw: string): string {
  const t = j ? j.text ?? j.answer ?? j.message ?? j.content : undefined;
  if (typeof t === "string" && t.trim()) return t;
  if (t && typeof t === "object") return toText(t) || Object.values(t).filter((v) => typeof v === "string").join("\n") || JSON.stringify(t, null, 2);
  const plain = toText(raw).replace(/^```(?:json)?|```$/g, "").trim();
  return plain && !/^\{[\s\S]*\}$/.test(plain) ? plain : "I couldn't put that into words — please rephrase the question.";
}

/**
 * The AI agent may only read the database named on its allocation — always the company's own database.
 * Anything else (a mismatch, or no allocation) is refused before a single query runs.
 */
export async function withAgentDb<T>(companyId: string, agentId: any, fn: () => Promise<T>): Promise<T> {
  const [alloc, own] = await Promise.all([AiAllocation.findOne({ companyId, agentId, allocated: { $ne: false } }).select("dbName").lean<any>(), dbOf(companyId)]);
  if (!alloc) throw new HttpError(402, "This AI model is not allocated to your company. Ask your Super Admin to allocate it (AI Agents › Allocation).");
  const db = alloc.dbName || own;
  if (db !== own) throw new HttpError(403, "This AI allocation points at a different database — ask your Super Admin to re-allocate the model.");
  return runInDb(db, fn);
}

/** Fields an external endpoint may never group by or list (personal data). */
const PII = /(^|_)(name|phone|whatsapp|email|address|comments?|remarks?|to|userlabel|payload|ip)$/i;
function aggregateOnly(spec: any) {
  if (!spec?.groupBy?.length && !spec?.metrics?.length) throw new Error("Only totals and breakdowns are available here (no individual records).");
  for (const g of spec.groupBy || []) if (PII.test(String(g).split(":")[0])) throw new Error("Personal details are not available here.");
  for (const f of spec.filters || []) if (PII.test(String(f.field))) throw new Error("Filtering on personal details is not available here.");
  return { ...spec, columns: undefined };
}

/** Shared read-only loop: the model asks for report specs, we run them in the agent's database, it answers. */
async function dataLoop(o: { a: AuthCtx; agent: any; ca: any; system: string; messages: Msg[]; purpose: string; guard?: (spec: any) => any }) {
  const convo: Msg[] = o.messages.slice(-12);
  let usage: any;
  const deadline = Date.now() + 52_000; // stay inside the 60 s serverless limit across all steps
  for (let step = 0; step < 4; step++) {
    const left = deadline - Date.now();
    if (left < 8_000) break;
    const r = await complete({ agent: o.agent, companyId: o.a.companyId!, system: o.system, messages: convo, purpose: o.purpose, userId: o.a.userId, companyAgentId: o.ca?._id, json: true, maxTokens: 900, timeoutMs: left });
    usage = r.usage;
    const j = parseJson(r.text);
    if (!j || j.action === "answer" || !j.spec) return { text: answerText(j, r.text), usage };
    let result: string;
    try {
      const spec = o.guard ? o.guard(j.spec) : j.spec;
      const rep = await runReport(o.a, { ...spec, limit: Math.min(Number(spec.limit) || 50, 100) });
      result = JSON.stringify({ title: rep.title, columns: rep.columns.map((c) => c.key), rows: rep.rows.slice(0, 100), truncated: rep.truncated });
    } catch (e: any) {
      result = JSON.stringify({ error: e.message });
    }
    convo.push({ role: "assistant", content: r.text }, { role: "user", content: `Query result: ${result}\nNow answer (or run one more query if essential).` });
  }
  return { text: "I couldn't get to an answer — please ask more specifically.", usage };
}

const LOOP_RULES = `Each turn reply with ONLY one JSON object:
- {"action": "query", "spec": <spec>}  to fetch data (you will receive the rows), or
- {"action": "answer", "text": "<markdown answer>"}
Prefer one well-aimed query. Never invent numbers.`;

export async function assistantChat(a: AuthCtx, messages: Msg[]) {
  const { ca, agent } = await loadAgent(a.companyId!, undefined, true);
  return withAgentDb(a.companyId!, agent._id, async () => {
    const kb = await knowledge(ca);
    const system = agentSystem(
      ca,
      kb,
      `You are the in-app assistant for ${a.companyName}, talking to ${a.name}. You have READ-ONLY access to this company's data only; you cannot create, edit, delete or send anything — if asked to, explain that and point to the right screen.
${SPEC_RULES(a)}
${LOOP_RULES}`
    );
    const r = await dataLoop({ a, agent, ca, system, messages, purpose: "assistant" });
    return { ...r, agent: ca.name };
  });
}

/**
 * AI endpoint (external systems): a question in, an answer out — from the knowledge base and, if enabled, the company's
 * own database (read-only). dataAccess: "none" | "aggregate" (totals/breakdowns only — safe for public bots) | "full".
 */
export async function endpointChat(ep: any, company: { _id: any; name: string }, messages: Msg[]) {
  const companyId = String(company._id);
  let ca: any = null;
  let agent: any;
  if (ep.mode === "agent") {
    ca = await CompanyAgent.findOne({ _id: ep.companyAgentId, companyId, active: true }).lean<any>();
    if (!ca?.agentId) throw new HttpError(400, "The AI agent behind this endpoint is missing or has no model");
    agent = await AiAgent.findOne({ _id: ca.agentId, active: true }).lean<any>();
  } else {
    agent = await AiAgent.findOne({ _id: ep.agentId, active: true }).lean<any>();
    ca = { _id: null, name: ep.name, systemPrompt: ep.instructions, knowledge: [] };
  }
  if (!agent) throw new HttpError(400, "The AI model behind this endpoint is unavailable");
  const a: AuthCtx = { userId: "", scope: "company", companyId, companyName: company.name, name: `Endpoint ${ep.name}`, email: "", isOwner: false, perms: { leads: { create: false, read: true, update: false, delete: false }, ai_agents: { create: false, read: true, update: false, delete: false } } } as any;
  return withAgentDb(companyId, agent._id, async () => {
    const kb = ca._id ? await knowledge(ca) : "";
    const extra = ep.instructions && ep.mode === "agent" ? `Additional instructions for this endpoint: ${ep.instructions}` : "";
    if (ep.dataAccess === "none") {
      const system = agentSystem(ca, kb, `You answer questions sent by an external system on behalf of ${company.name}. ${extra}\nAnswer in plain text, concisely.`);
      const r = await complete({ agent, companyId, system, messages: messages.slice(-12), purpose: "endpoint", companyAgentId: ca._id });
      return { text: r.text, usage: r.usage };
    }
    const scope = ep.dataAccess === "full" ? "You may list individual records when asked." : "You may ONLY use totals and breakdowns (groupBy + metrics). Never reveal names, phone numbers, emails or other personal details.";
    const system = agentSystem(ca, kb, `You answer questions sent by an external system on behalf of ${company.name}. You have READ-ONLY access to ${company.name}'s data only. ${scope} ${extra}
${SPEC_RULES(a)}
${LOOP_RULES}`);
    return dataLoop({ a, agent, ca, system, messages, purpose: "endpoint", guard: ep.dataAccess === "full" ? undefined : aggregateOnly });
  });
}

export async function assistantInfo(companyId: string) {
  const ca = await CompanyAgent.findOne({ companyId, active: true, isAssistant: true }).select("name purpose agentId").lean<any>();
  const model = ca?.agentId && (await AiAgent.exists({ _id: ca.agentId, active: true })) ? await AiAllocation.exists({ companyId, agentId: ca.agentId, allocated: { $ne: false } }) : null;
  return ca ? { enabled: true, ready: !!model, name: ca.name, purpose: ca.purpose } : { enabled: false, ready: false };
}

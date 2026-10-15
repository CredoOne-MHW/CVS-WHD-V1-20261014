import { AiAgent, CompanyAgent } from "../models";
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
  const agent = await AiAgent.findOne({ _id: ca.agentId, active: true }).lean();
  if (!agent) throw new HttpError(400, "The AI model behind this agent is unavailable");
  return { ca, agent };
}

/** Agentic report: the AI turns a plain-English request into a spec, we run it read-only, the AI summarises. */
export async function agenticReport(a: AuthCtx, companyAgentId: string, prompt: string) {
  const { ca, agent } = await loadAgent(a.companyId!, companyAgentId);
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

export async function assistantChat(a: AuthCtx, messages: Msg[]) {
  const { ca, agent } = await loadAgent(a.companyId!, undefined, true);
  const kb = await knowledge(ca);
  const system = agentSystem(
    ca,
    kb,
    `You are the in-app assistant for ${a.companyName}, talking to ${a.name}. You have READ-ONLY access to company data; you cannot create, edit, delete or send anything — if asked to, explain that and point to the right screen.
${SPEC_RULES(a)}
Each turn reply with ONLY one JSON object:
- {"action": "query", "spec": <spec>}  to fetch data (you will receive the rows), or
- {"action": "answer", "text": "<markdown answer for the user>"}
Prefer one well-aimed query. Never invent numbers.`
  );
  const convo: Msg[] = messages.slice(-12);
  let usage: any;
  const deadline = Date.now() + 52_000; // stay inside the 60 s serverless limit across all steps
  for (let step = 0; step < 4; step++) {
    const left = deadline - Date.now();
    if (left < 8_000) break;
    const r = await complete({ agent, companyId: a.companyId!, system, messages: convo, purpose: "assistant", userId: a.userId, companyAgentId: ca._id, json: true, maxTokens: 900, timeoutMs: left });
    usage = r.usage;
    const j = parseJson(r.text);
    if (!j || j.action === "answer" || !j.spec) return { text: answerText(j, r.text), usage, agent: ca.name };
    let result: string;
    try {
      const rep = await runReport(a, { ...j.spec, limit: Math.min(Number(j.spec.limit) || 50, 100) });
      result = JSON.stringify({ title: rep.title, columns: rep.columns.map((c) => c.key), rows: rep.rows.slice(0, 100), truncated: rep.truncated });
    } catch (e: any) {
      result = JSON.stringify({ error: e.message });
    }
    convo.push({ role: "assistant", content: r.text }, { role: "user", content: `Query result: ${result}\nNow answer the user (or run one more query if essential).` });
  }
  return { text: "I couldn't get to an answer — try asking more specifically.", usage, agent: ca.name };
}

export async function assistantInfo(companyId: string) {
  const ca = await CompanyAgent.findOne({ companyId, active: true, isAssistant: true }).select("name purpose agentId").lean<any>();
  const model = ca?.agentId ? await AiAgent.exists({ _id: ca.agentId, active: true }) : null;
  return ca ? { enabled: true, ready: !!model, name: ca.name, purpose: ca.purpose } : { enabled: false, ready: false };
}

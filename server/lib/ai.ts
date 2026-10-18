import { openUntil, record, retryable } from "./circuit";
import { toText, stripThinking, errorText } from "../../shared/text";
import { renewAllocations } from "./billing";
import { AiAllocation, AiUsage, AiProvider, Company, User } from "../models";
import { decrypt } from "./crypto";
import { getObjectText } from "./s3";
import { HttpError } from "./http";
import { cached } from "./cache";
import { fireEvent } from "./whatsapp";

export type Msg = { role: "user" | "assistant"; content: string };

const LEGACY_STYLE: Record<string, { apiStyle: string; baseUrl: string }> = {
  anthropic: { apiStyle: "anthropic", baseUrl: "https://api.anthropic.com" },
  openai: { apiStyle: "openai", baseUrl: "https://api.openai.com/v1" },
  google: { apiStyle: "google", baseUrl: "https://generativelanguage.googleapis.com" },
  "openai-compatible": { apiStyle: "openai", baseUrl: "" },
};

async function providerFor(agent: any) {
  const p = await cached(`ai:provider:${agent.provider}`, 300, () => AiProvider.findOne({ key: agent.provider }).lean<any>());
  const legacy = LEGACY_STYLE[agent.provider];
  return {
    apiStyle: p?.apiStyle || legacy?.apiStyle || "openai",
    baseUrl: (agent.url || p?.baseUrl || legacy?.baseUrl || "").replace(/\/$/, ""),
    headers: (p?.extraHeaders || {}) as Record<string, string>,
  };
}

/** Raw provider call. Returns text + token counts. */
async function callProvider(agent: any, system: string, messages: Msg[], opts: { maxTokens?: number; json?: boolean; timeoutMs?: number }) {
  const key = decrypt(agent.apiKeyEnc);
  if (!key) throw new HttpError(400, "This AI model has no API key configured");
  const p = await providerFor(agent);
  const timeout = AbortSignal.timeout(Math.max(5_000, Math.min(opts.timeoutMs ?? 50_000, 50_000))); // Vercel function cap is 60 s
  const max = Math.max(opts.maxTokens || 1500, 1500); // reasoning models (Kimi K2.5, o-series, R1) spend tokens thinking first

  if (p.apiStyle === "anthropic") {
    const r = await fetch(`${p.baseUrl || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", ...p.headers },
      body: JSON.stringify({ model: agent.llmVersion, max_tokens: max, system, messages }),
      signal: timeout,
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j?.type === "error") throw Object.assign(new HttpError(502, errorText(j, r.status)), { providerStatus: r.status });
    return { text: stripThinking(toText((j.content || []).filter((c: any) => c.type === "text"))), inTok: j.usage?.input_tokens || 0, outTok: j.usage?.output_tokens || 0 };
  }
  if (p.apiStyle === "google") {
    const r = await fetch(`${p.baseUrl}/v1beta/models/${agent.llmVersion}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...p.headers },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: max, ...(opts.json ? { responseMimeType: "application/json" } : {}) },
      }),
      signal: timeout,
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j?.error) throw Object.assign(new HttpError(502, errorText(j, r.status)), { providerStatus: r.status });
    return { text: stripThinking(toText(j.candidates?.[0]?.content?.parts?.filter((x: any) => !x.thought))), inTok: j.usageMetadata?.promptTokenCount || 0, outTok: j.usageMetadata?.candidatesTokenCount || 0 };
  }
  // OpenAI wire format: OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Together, any compatible gateway
  const r = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...p.headers },
    body: JSON.stringify({ model: agent.llmVersion, max_tokens: max, messages: [{ role: "system", content: system }, ...messages], ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
    signal: timeout,
  });
  const raw = await r.text();
  let j: any = {};
  try {
    j = raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(502, `AI provider returned an invalid response (${r.status}). Please try again.`);
  }
  // OpenRouter can answer 200 with an error body when the upstream provider fails
  if (!r.ok || j?.error || !Array.isArray(j?.choices)) throw Object.assign(new HttpError(502, errorText(j, r.status)), { providerStatus: r.status });
  const msg = j.choices[0]?.message || {};
  let text = stripThinking(toText(msg.content));
  if (!text && (msg.reasoning || msg.reasoning_content)) text = "I ran out of room before finishing my answer. Please ask again, a little more specifically.";
  return { text, inTok: j.usage?.prompt_tokens || 0, outTok: j.usage?.completion_tokens || 0 };
}

/**
 * The company's credit wallet for a model — only exists when Super Admin allocated the model
 * (Super Admin › AI Agents › Allocation). Credits renew on the renewal date; if the daily job hasn't run yet,
 * the renewal is applied here first so the company never waits for it.
 */
export async function walletFor(companyId: any, agent: any) {
  const a = await AiAllocation.findOne({ companyId, agentId: agent._id, allocated: { $ne: false } });
  if (a?.renewalDate && a.renewalDate <= new Date()) {
    await renewAllocations(new Date(), { _id: a._id });
    return AiAllocation.findById(a._id);
  }
  return a;
}

/** Credits left for a company on a model; throws 402 when exhausted (after alerting once). */
async function ensureCredits(companyId: string, agent: any) {
  const alloc = await walletFor(companyId, agent);
  if (!alloc) throw new HttpError(402, "This AI model is not allocated to your company. Ask your Super Admin to allocate it (AI Agents › Allocation).");
  if (alloc.credits - alloc.used <= 0) {
    await notifyExhausted(companyId, agent, alloc);
    throw new HttpError(402, "AI credits are exhausted. Your administrator has been notified on WhatsApp.");
  }
  return alloc;
}

/** WhatsApp alert to the company admin (+ Super Admin hook) the first time credits run out. */
async function notifyExhausted(companyId: string, agent: any, alloc: any) {
  if (alloc.exhaustedNotifiedAt) return;
  const claimed = await AiAllocation.updateOne({ _id: alloc._id, exhaustedNotifiedAt: null }, { $set: { exhaustedNotifiedAt: new Date() } });
  if (!claimed.modifiedCount) return; // another instance already sent it
  const company = await Company.findById(companyId).lean<any>();
  const owner = await User.findOne({ companyId, isOwner: true }).lean<any>();
  const phone = owner?.phone || company?.whatsapp || company?.phone;
  const message = `AI credits exhausted for "${agent.name}" at ${company?.name}. Used ${Number(alloc.used).toFixed(1)} of ${alloc.credits} credits. The AI assistant and AI reports are paused until credits are topped up.`;
  if (phone) fireEvent("company", companyId, "ai_credits_exhausted", { phone, name: owner?.name, company: company?.name, message, params: { agent: agent.name, credits: alloc.credits } }).catch(() => undefined);
  if (company?.whatsapp) fireEvent("super", undefined, "credits_low", { phone: company.whatsapp, name: company.contactPerson, company: company.name, message }).catch(() => undefined);
}

/**
 * One metered completion. weighted = in × w_in + out × w_out; credits = weighted / 1000.
 * Every AI feature (chat test, assistant, agentic reports) goes through here.
 */
export async function complete(args: { agent: any; companyId: string; system: string; messages: Msg[]; purpose: string; userId?: string; companyAgentId?: any; maxTokens?: number; json?: boolean; timeoutMs?: number }) {
  const alloc = await ensureCredits(args.companyId, args.agent);
  // provider outage handling: a shared circuit breaker fails fast while the provider is down, and a transient failure
  // (network, 429, 5xx) gets one quick retry with jittered backoff when there is time for it
  const breaker = `ai:${args.agent.provider || "provider"}`;
  if (await openUntil(breaker)) throw new HttpError(503, "The AI provider is temporarily unavailable. Please try again in a few minutes.");
  const started = Date.now();
  let out;
  for (let attempt = 1; ; attempt++) {
    try {
      out = await callProvider(args.agent, args.system, args.messages, args);
      await record(breaker, true);
      break;
    } catch (e: any) {
      const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
      const status = e?.providerStatus ?? (e instanceof HttpError ? -1 : 0); // 0 = network error, -1 = our own validation
      const transient = !timeout && status !== -1 && retryable(status);
      if (transient || timeout) await record(breaker, false, e?.message);
      const budget = (args.timeoutMs || 55_000) - (Date.now() - started);
      if (transient && attempt === 1 && budget > 20_000) {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
        continue;
      }
      if (timeout) throw new HttpError(504, "The AI model took too long to answer. Please try again, or ask a shorter question.");
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `Could not reach the AI provider (${e?.message || "network error"}).`);
    }
  }
  const { text, inTok, outTok } = out;
  const weighted = inTok * (args.agent.tokenWeights?.input ?? 1) + outTok * (args.agent.tokenWeights?.output ?? 1);
  const credits = weighted / 1000;
  const after = await AiAllocation.findOneAndUpdate({ _id: alloc._id }, { $inc: { used: credits } }, { new: true }).lean<any>();
  AiUsage.create({ companyId: args.companyId, agentId: args.agent._id, companyAgentId: args.companyAgentId, purpose: args.purpose, userId: args.userId, inputTokens: inTok, outputTokens: outTok, weighted, credits, cost: credits * (args.agent.actualRate || 0), billed: credits * (args.agent.companyRate || 0) }).catch(() => undefined);
  const remaining = (after?.credits || 0) - (after?.used || 0);
  if (remaining <= 0 && after) notifyExhausted(args.companyId, args.agent, after).catch(() => undefined);
  return { text, usage: { inputTokens: inTok, outputTokens: outTok, credits: Number(credits.toFixed(3)), remaining: Number(remaining.toFixed(3)) } };
}

const KB_CHAR_BUDGET = 60_000;
/** Knowledge base text (cached 5 min per agent). */
export async function knowledge(companyAgent: any) {
  return cached(`ai:kb:${companyAgent._id}:${companyAgent.updatedAt ? new Date(companyAgent.updatedAt).getTime() : 0}`, 300, async () => {
    let out = "";
    for (const k of companyAgent.knowledge || []) {
      if (!k.extractedKey) continue;
      const t = await getObjectText(k.extractedKey).catch(() => "");
      out += `\n\n<file name="${k.fileName}">\n${t}\n</file>`;
      if (out.length > KB_CHAR_BUDGET) break;
    }
    return out.slice(0, KB_CHAR_BUDGET);
  });
}

export function agentSystem(companyAgent: any, kb: string, extra = "") {
  return [
    companyAgent.systemPrompt || `You are ${companyAgent.name}, an assistant for a sales team.`,
    companyAgent.purpose ? `Purpose: ${companyAgent.purpose}` : "",
    ...(companyAgent.prompts || []).map((p: any) => `${p.title}: ${p.text}`),
    extra,
    kb ? `Use only this knowledge base when answering factual questions about the business:${kb}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Plain chat with a company agent (used by the "Test" window). */
export async function chat({ agent, companyAgent, companyId, messages, userId }: { agent: any; companyAgent: any; companyId: string; messages: Msg[]; userId?: string }) {
  const kb = await knowledge(companyAgent);
  return complete({ agent, companyId, system: agentSystem(companyAgent, kb), messages, purpose: "chat", userId, companyAgentId: companyAgent._id });
}

/** Parse the first JSON object in a model reply (models sometimes wrap JSON in prose or fences). */
export function parseJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(t.slice(s, e + 1));
    } catch {}
  }
  return null;
}

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
async function callProvider(agent: any, system: string, messages: Msg[], opts: { maxTokens?: number; json?: boolean }) {
  const key = decrypt(agent.apiKeyEnc);
  if (!key) throw new HttpError(400, "This AI model has no API key configured");
  const p = await providerFor(agent);
  const timeout = AbortSignal.timeout(55_000);
  const max = opts.maxTokens || 1200;

  if (p.apiStyle === "anthropic") {
    const r = await fetch(`${p.baseUrl || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", ...p.headers },
      body: JSON.stringify({ model: agent.llmVersion, max_tokens: max, system, messages }),
      signal: timeout,
    });
    const j: any = await r.json();
    if (!r.ok) throw new HttpError(502, j?.error?.message || `Provider error ${r.status}`);
    return { text: (j.content || []).map((c: any) => c.text || "").join(""), inTok: j.usage?.input_tokens || 0, outTok: j.usage?.output_tokens || 0 };
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
    const j: any = await r.json();
    if (!r.ok) throw new HttpError(502, j?.error?.message || `Provider error ${r.status}`);
    return { text: j.candidates?.[0]?.content?.parts?.map((x: any) => x.text).join("") || "", inTok: j.usageMetadata?.promptTokenCount || 0, outTok: j.usageMetadata?.candidatesTokenCount || 0 };
  }
  // OpenAI wire format: OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Together, any compatible gateway
  const r = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...p.headers },
    body: JSON.stringify({ model: agent.llmVersion, max_tokens: max, messages: [{ role: "system", content: system }, ...messages], ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
    signal: timeout,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, j?.error?.message || `Provider error ${r.status}`);
  return { text: j.choices?.[0]?.message?.content || "", inTok: j.usage?.prompt_tokens || 0, outTok: j.usage?.completion_tokens || 0 };
}

/** Credits left for a company on a model; throws 402 when exhausted (after alerting once). */
async function ensureCredits(companyId: string, agent: any) {
  const alloc = await AiAllocation.findOne({ companyId, agentId: agent._id });
  if (!alloc) throw new HttpError(402, "This AI model is not allocated to your company.");
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
export async function complete(args: { agent: any; companyId: string; system: string; messages: Msg[]; purpose: string; userId?: string; companyAgentId?: any; maxTokens?: number; json?: boolean }) {
  const alloc = await ensureCredits(args.companyId, args.agent);
  const { text, inTok, outTok } = await callProvider(args.agent, args.system, args.messages, args);
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

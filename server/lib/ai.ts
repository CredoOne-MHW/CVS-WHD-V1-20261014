import { AiAllocation, AiUsage } from "../models";
import { decrypt } from "./crypto";
import { getObjectText } from "./s3";
import { HttpError } from "./http";

interface ChatArgs {
  agent: any; // platform AiAgent
  companyAgent: any;
  companyId: string;
  messages: { role: "user" | "assistant"; content: string }[];
}

const KB_CHAR_BUDGET = 60_000;

async function knowledge(companyAgent: any) {
  let out = "";
  for (const k of companyAgent.knowledge || []) {
    if (!k.extractedKey) continue;
    const t = await getObjectText(k.extractedKey).catch(() => "");
    out += `\n\n<file name="${k.fileName}">\n${t}\n</file>`;
    if (out.length > KB_CHAR_BUDGET) break;
  }
  return out.slice(0, KB_CHAR_BUDGET);
}

/** Calls the configured provider and meters credits: weighted = in*wIn + out*wOut; credits = weighted/1000. */
export async function chat({ agent, companyAgent, companyId, messages }: ChatArgs) {
  const alloc = await AiAllocation.findOne({ companyId, agentId: agent._id });
  if (!alloc || alloc.credits - alloc.used <= 0) throw new HttpError(402, "No AI credits left for this model. Ask your administrator to allocate credits.");

  const kb = await knowledge(companyAgent);
  const system = [
    companyAgent.systemPrompt || `You are ${companyAgent.name}, an assistant for a sales team.`,
    companyAgent.purpose ? `Purpose: ${companyAgent.purpose}` : "",
    ...(companyAgent.prompts || []).map((p: any) => `${p.title}: ${p.text}`),
    kb ? `Use only this knowledge base when answering factual questions:${kb}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const key = decrypt(agent.apiKeyEnc);
  if (!key) throw new HttpError(400, "This model has no API key configured");
  let text = "";
  let inTok = 0;
  let outTok = 0;

  if (agent.provider === "anthropic") {
    const r = await fetch(`${agent.url || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: agent.llmVersion, max_tokens: 1024, system, messages }),
      signal: AbortSignal.timeout(50_000),
    });
    const j: any = await r.json();
    if (!r.ok) throw new HttpError(502, j?.error?.message || `Provider error ${r.status}`);
    text = (j.content || []).map((c: any) => c.text || "").join("");
    inTok = j.usage?.input_tokens || 0;
    outTok = j.usage?.output_tokens || 0;
  } else if (agent.provider === "google") {
    const base = agent.url || "https://generativelanguage.googleapis.com";
    const r = await fetch(`${base}/v1beta/models/${agent.llmVersion}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })) }),
      signal: AbortSignal.timeout(50_000),
    });
    const j: any = await r.json();
    if (!r.ok) throw new HttpError(502, j?.error?.message || `Provider error ${r.status}`);
    text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
    inTok = j.usageMetadata?.promptTokenCount || 0;
    outTok = j.usageMetadata?.candidatesTokenCount || 0;
  } else {
    // openai + any OpenAI-compatible endpoint
    const r = await fetch(`${(agent.url || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: agent.llmVersion, messages: [{ role: "system", content: system }, ...messages] }),
      signal: AbortSignal.timeout(50_000),
    });
    const j: any = await r.json();
    if (!r.ok) throw new HttpError(502, j?.error?.message || `Provider error ${r.status}`);
    text = j.choices?.[0]?.message?.content || "";
    inTok = j.usage?.prompt_tokens || 0;
    outTok = j.usage?.completion_tokens || 0;
  }

  const weighted = inTok * (agent.tokenWeights?.input ?? 1) + outTok * (agent.tokenWeights?.output ?? 1);
  const credits = weighted / 1000;
  await AiAllocation.updateOne({ _id: alloc._id }, { $inc: { used: credits } });
  await AiUsage.create({ companyId, agentId: agent._id, companyAgentId: companyAgent._id, inputTokens: inTok, outputTokens: outTok, weighted, credits, cost: credits * (agent.actualRate || 0), billed: credits * (agent.companyRate || 0) });
  return { text, usage: { inputTokens: inTok, outputTokens: outTok, credits: Number(credits.toFixed(3)), remaining: Number((alloc.credits - alloc.used - credits).toFixed(3)) } };
}

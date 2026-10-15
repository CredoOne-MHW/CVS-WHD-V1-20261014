/** AI replies arrive as a string, an array of parts, or an object — always render plain text. */
export function toText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(toText).join("");
  if (typeof v === "object") return toText(v.text ?? v.content ?? "");
  return String(v);
}

/** Removes reasoning blocks some models (Kimi, DeepSeek R1, Qwen) put inside the answer. */
export function stripThinking(s: string): string {
  return s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/^[\s\S]*?<\/think(?:ing)?>/i, "").trim();
}

/** Human-readable message from any provider error body. */
export function errorText(body: any, status: number): string {
  const e = body?.error ?? body?.message ?? body;
  const msg = typeof e === "string" ? e : toText(e?.message) || toText(e?.metadata?.raw) || (e ? JSON.stringify(e).slice(0, 200) : "");
  return `AI provider error ${status}${msg ? `: ${msg}` : ""}`.slice(0, 400);
}

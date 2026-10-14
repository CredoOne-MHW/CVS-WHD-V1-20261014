import { normalizePhone } from "./constants";

export interface SendContext {
  phone: string;
  name?: string;
  company?: string;
  message: string; // raw, may be multi-line
  params?: Record<string, any>;
}

/**
 * Renders a payload template. Placeholders inside quotes are JSON-escaped;
 * placeholders that resolve to objects/arrays ({{params}}) are inserted as raw JSON.
 * Unknown placeholders render as empty strings.
 */
export function renderTemplate(template: string, vars: Record<string, any>): { body: any; text: string } {
  const lookup = (path: string) => path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), vars);
  const text = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, p) => {
    const v = lookup(p);
    if (v !== null && typeof v === "object") return JSON.stringify(v);
    return JSON.stringify(v == null ? "" : String(v)).slice(1, -1);
  });
  try {
    return { body: JSON.parse(text), text };
  } catch {
    throw new Error("Payload template is not valid JSON after rendering. Check quotes around placeholders.");
  }
}

/** Collapse line breaks/tabs for WhatsApp template variables (Meta rejects \n and \t in params). */
export function toSingleLine(raw: string, sep = " | ") {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\t+/g, " ").replace(/ {4,}/g, "   ").trim())
    .filter(Boolean)
    .join(sep);
}

/**
 * Split a long message into parts that each fit maxChars, preferring block
 * boundaries (blank lines), then sentence ends, then hard cut. Parts get "(Part i/n)".
 */
export function splitMessage(raw: string, maxChars = 800): string[] {
  const limit = Math.max(120, maxChars - 14); // leave room for " (Part 10/12)"
  if (raw.length <= maxChars) return [raw];
  const blocks = raw.split(/\n\s*\n/);
  const parts: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) parts.push(cur.trim());
    cur = "";
  };
  for (const block of blocks) {
    const candidate = cur ? `${cur}\n\n${block}` : block;
    if (candidate.length <= limit) {
      cur = candidate;
      continue;
    }
    push();
    if (block.length <= limit) {
      cur = block;
      continue;
    }
    // block itself too big → sentence split
    for (const s of block.split(/(?<=[.!?।])\s+/)) {
      if ((cur ? cur.length + 1 : 0) + s.length <= limit) cur = cur ? `${cur} ${s}` : s;
      else {
        push();
        for (let i = 0; i < s.length; i += limit) {
          const chunk = s.slice(i, i + limit);
          if (chunk.length === limit) parts.push(chunk);
          else cur = chunk;
        }
      }
    }
  }
  push();
  return parts.length > 1 ? parts.map((p, i) => `${p} (Part ${i + 1}/${parts.length})`) : parts;
}

export function buildPayloads(hook: any, ctx: SendContext) {
  const sep = hook.lineSeparator === "" || hook.lineSeparator == null ? " | " : hook.lineSeparator;
  const pieces = splitMessage(ctx.message, hook.maxChars || 800);
  const phone = normalizePhone(ctx.phone);
  return pieces.map((piece, i) => {
    const message = hook.singleLine ? toSingleLine(piece, sep) : piece;
    const vars = {
      event: hook.event,
      template: hook.templateName || hook.event,
      to: `91${phone}`,
      phone,
      name: ctx.name || "",
      company: ctx.company || "",
      message,
      message_raw: piece,
      params: { name: ctx.name || "", company: ctx.company || "", ...(ctx.params || {}) },
    };
    return { part: pieces.length > 1 ? `${i + 1}/${pieces.length}` : undefined, ...renderTemplate(hook.payloadTemplate, vars) };
  });
}


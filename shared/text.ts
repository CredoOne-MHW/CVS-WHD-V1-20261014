/** AI replies arrive as a string, an array of parts, or an object — always render plain text. */
export function toText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(toText).join("");
  if (typeof v === "object") return toText(v.text ?? v.content ?? "");
  return String(v);
}

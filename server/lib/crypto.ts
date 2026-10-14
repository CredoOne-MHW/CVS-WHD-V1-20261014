import crypto from "crypto";

function key() {
  const raw = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET || "dev-insecure-key";
  return crypto.createHash("sha256").update(raw).digest();
}

/** AES-256-GCM for secrets at rest (webhook headers, connector secrets, LLM keys). */
export function encrypt(plain: string | undefined | null): string | undefined {
  if (plain == null || plain === "") return undefined;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(blob: string | undefined | null): string {
  if (!blob) return "";
  try {
    const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export const randomKey = (bytes = 12) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export function hmacValid(secret: string, body: string, signature: string | undefined) {
  if (!signature) return false;
  const sig = signature.replace(/^sha256=/, "");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
export function maskSecret(s: string) {
  return s ? `${s.slice(0, 4)}…${s.slice(-4)}` : "";
}

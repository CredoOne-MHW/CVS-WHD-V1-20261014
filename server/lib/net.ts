import { lookup } from "dns/promises";
import { isIP } from "net";
import { HttpError } from "./http";

/** Blocks server-side requests to private / loopback / link-local / metadata addresses (SSRF guard for user-entered URLs). */
function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80")) return true;
    const v4 = x.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return v4 ? privateIp(v4[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function assertPublicUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "Enter a valid URL");
  }
  const dev = process.env.NODE_ENV !== "production" || process.env.ALLOW_PRIVATE_URLS === "1";
  if (u.protocol !== "https:" && !(dev && u.protocol === "http:")) throw new HttpError(400, "The URL must start with https://");
  if (dev) return u;
  if (/^(localhost|metadata\.google\.internal)$/i.test(u.hostname)) throw new HttpError(400, "That address is not allowed");
  const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, `Could not resolve ${u.hostname}`);
  if (addrs.some((a) => privateIp(a.address))) throw new HttpError(400, "Private or internal addresses are not allowed");
  return u;
}

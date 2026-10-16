/**
 * Do-not-collect list for Public Web Prospecting.
 * When a prospected lead is deleted (e.g. the person asked to be removed), one-way hashes of their phone, WhatsApp, email
 * and profile link are kept — never the values themselves — so later runs skip them even if they appear on another page.
 * Hashes are salted with the company id, so the same person can't be correlated across companies.
 */
import { Suppression } from "../models";
import { normalizePhone } from "../../shared/constants";
import { sha256 } from "./crypto";

type Ids = { phone?: string | null; whatsapp?: string | null; email?: string | null; profileUrl?: string | null };

function hashes(companyId: any, p: Ids) {
  const vals = new Set<string>();
  for (const ph of [p.phone, p.whatsapp]) {
    const n = ph ? normalizePhone(ph) : "";
    if (n) vals.add(`p:${n.replace(/\D/g, "").slice(-10)}`);
  }
  if (p.email && p.email !== "NA") vals.add(`e:${String(p.email).trim().toLowerCase()}`);
  if (p.profileUrl && p.profileUrl !== "NA") vals.add(`u:${String(p.profileUrl).trim().toLowerCase().replace(/\/+$/, "")}`);
  return [...vals].map((v) => sha256(`${companyId}|${v}`));
}

/** Call inside the company's database context. */
export async function suppress(companyId: any, p: Ids) {
  const hs = hashes(companyId, p);
  if (!hs.length) return 0;
  await Suppression.bulkWrite(hs.map((hash) => ({ updateOne: { filter: { hash }, update: { $setOnInsert: { hash, at: new Date() } }, upsert: true } })), { ordered: false }).catch(() => undefined);
  return hs.length;
}

/** True if any identifier of this person is on the company's do-not-collect list. */
export async function isSuppressed(companyId: any, p: Ids) {
  const hs = hashes(companyId, p);
  return hs.length ? !!(await Suppression.exists({ hash: { $in: hs } })) : false;
}

export const fromProspecting = (lead: any) => lead?.source === "web_prospect" || (lead?.attribution || []).some((a: any) => a?.source === "web_prospect");

/**
 * DPDP consent engine.
 *
 * A company's notice can be written here (Markdown → HTML) or uploaded as a PDF or Word file, in which case
 * the text is extracted so the consent screen can show it as a page that scrolls — a browser's built-in PDF
 * viewer cannot be watched, and the Act's "read before you accept" is the whole point of the screen. The
 * original file is kept in the company's own S3 folder and offered as a download beside the text.
 *
 * Placeholders ({{company.name}} and friends) are filled when the notice is shown, so the platform's default
 * notice serves every company without being copied.
 */
import { marked } from "marked";
import { Company, DpdpDocument, DpdpConsent, CookieConsent } from "../models";
import { putAt, getObject } from "./s3";
import { s3Area } from "../../shared/platform";
import { DEFAULT_NOTICE, fillVars, missingVars, hasRead, REQUIRED_PURPOSES, type SubjectKind } from "../../shared/dpdp";
import { tenantUrls } from "./tenant";

/* ───────────────────────── Rendering ───────────────────────── */

/** Markdown → the HTML the consent screen shows. Nothing but text formatting survives. */
export function toHtml(markdown: string) {
  const raw = marked.parse(String(markdown || ""), { async: false }) as string;
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/ on[a-z]+="[^"]*"/gi, "")
    .replace(/ on[a-z]+='[^']*'/gi, "");
}

/** Plain paragraphs → HTML, for text pulled out of a PDF or Word file. */
function textToHtml(text: string) {
  const blocks = String(text || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map((b) => {
      const line = b.replace(/\n/g, " ").trim();
      // a short line in capitals, or one numbered like a clause, reads as a heading
      if (line.length < 90 && (/^[0-9]+[.)]\s+\S/.test(line) || line === line.toUpperCase())) return `<h2>${esc(line)}</h2>`;
      return `<p>${esc(line)}</p>`;
    })
    .join("\n");
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Pulls the text out of an uploaded notice. Returns HTML the screen can scroll. */
export async function extractUpload(buffer: Buffer, fileName: string, mime: string) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") {
    const pdf = (await import("pdf-parse")).default as any;
    const out = await pdf(buffer);
    return { html: textToHtml(out.text), words: String(out.text || "").split(/\s+/).filter(Boolean).length };
  }
  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const out = await mammoth.convertToHtml({ buffer });
    const html = out.value.replace(/<img[^>]*>/gi, "");
    return { html, words: html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length };
  }
  if (ext === "md" || ext === "txt") {
    const text = buffer.toString("utf8");
    return { html: ext === "md" ? toHtml(text) : textToHtml(text), words: text.split(/\s+/).filter(Boolean).length };
  }
  throw new Error("Upload a PDF, Word (.docx), Markdown or text file");
}

/* ───────────────────────── The company's notice ───────────────────────── */

/** The values that fill a notice's placeholders for one company. */
export function varsFor(company: any) {
  const urls = tenantUrls(company);
  return {
    "company.name": company?.branding?.shortName || company?.name,
    "company.legalName": company?.legalName || company?.name,
    "company.address": [company?.address, company?.city, company?.state, company?.pin].filter(Boolean).join(", "),
    "company.email": company?.contactEmail || company?.email,
    "company.phone": company?.phone || company?.whatsapp,
    "company.website": (urls.customUrl || urls.platformUrl || "").replace(/^https?:\/\//, ""),
    "company.officer": company?.dpdpOfficer || company?.contactPerson,
    "company.officerEmail": company?.dpdpOfficerEmail || company?.contactEmail || company?.email,
    today: new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "long", year: "numeric" }),
  } as Record<string, string | undefined>;
}

/** The platform's default notice, created on first use so Super Admin can edit it like any other. */
export async function platformDefault() {
  let doc = await DpdpDocument.findOne({ companyId: null, active: true }).lean<any>();
  if (!doc) {
    doc = (
      await DpdpDocument.create({
        companyId: null,
        title: "Notice of collection and processing of personal data",
        source: "builtin",
        markdown: DEFAULT_NOTICE,
        html: toHtml(DEFAULT_NOTICE),
        words: DEFAULT_NOTICE.split(/\s+/).length,
        active: true,
        publishedAt: new Date(),
        publishedBy: "platform",
      })
    ).toObject();
  }
  return doc;
}

/**
 * What a company actually shows: its own published notice, or the platform's default with the company's
 * details filled in. Never returns nothing, so a consent link always works.
 */
export async function noticeFor(company: any) {
  const own = await DpdpDocument.findOne({ companyId: company._id, active: true }).sort({ version: -1 }).lean<any>();
  const doc = own || (await platformDefault());
  const vars = varsFor(company);
  return {
    _id: doc._id,
    version: doc.version,
    title: fillVars(doc.title, vars),
    html: fillVars(doc.html || "", vars),
    source: doc.source,
    fileName: doc.fileName,
    hasFile: !!doc.fileKey,
    usingDefault: !own,
    missing: missingVars(`${doc.title} ${doc.markdown || doc.html || ""}`, vars),
    updatedAt: doc.publishedAt || doc.updatedAt,
  };
}

/** Saves a new version and makes it the live one. Older versions stay, so old acceptances still resolve. */
export async function publish(companyId: any, body: { title: string; markdown?: string; html?: string; source: "builtin" | "upload"; fileKey?: string; fileName?: string; fileType?: string; words?: number; notes?: string }, by: string) {
  const last = await DpdpDocument.findOne({ companyId: companyId || null }).sort({ version: -1 }).select("version").lean<any>();
  await DpdpDocument.updateMany({ companyId: companyId || null, active: true }, { $set: { active: false } });
  return (
    await DpdpDocument.create({
      companyId: companyId || null,
      title: body.title,
      version: (last?.version || 0) + 1,
      source: body.source,
      markdown: body.markdown,
      html: body.html,
      fileKey: body.fileKey,
      fileName: body.fileName,
      fileType: body.fileType,
      words: body.words,
      notes: body.notes,
      active: true,
      publishedAt: new Date(),
      publishedBy: by,
    })
  ).toObject();
}

/** Stores an uploaded notice in the company's own folder. */
export async function storeUpload(company: any, buffer: Buffer, fileName: string, mime: string) {
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-80);
  const { key } = await putAt(`${s3Area(company.code, "dpdp")}/${Date.now()}-${safe}`, buffer, mime || "application/octet-stream");
  return key;
}
export const downloadNotice = (key: string) => getObject(key);

/* ───────────────────────── Recording a consent ───────────────────────── */

export interface AcceptInput {
  companyId: any;
  documentId: any;
  documentVersion?: number;
  subjectKind?: SubjectKind;
  subjectId?: string;
  visitorId?: string;
  name?: string;
  email?: string;
  phone?: string;
  purposes: string[];
  source?: string;
  page?: string;
  openedAt?: Date;
  readSeconds: number;
  scrollPct: number;
  reachedEndAt?: Date;
  ip?: string;
  userAgent?: string;
}

/**
 * Writes the acceptance. Refuses when the required purposes are not all ticked, or when the person plainly
 * did not read the notice — the screen enforces both, and so does this, because the screen is only a screen.
 */
export async function accept(input: AcceptInput) {
  const missing = REQUIRED_PURPOSES.filter((p) => !input.purposes.includes(p));
  if (missing.length) throw new Error(`These are needed to continue: ${missing.join(", ")}`);
  if (!hasRead(input.scrollPct || 0, input.readSeconds || 0)) throw new Error("Please read the notice to the end before accepting");
  return DpdpConsent.create({
    ...input,
    acceptedAt: new Date(),
    purposes: input.purposes,
  });
}

/** Withdrawing is as easy as giving — the row stays, marked withdrawn, because the record itself must survive. */
export async function withdraw(companyId: any, consentId: any, by: string) {
  return DpdpConsent.findOneAndUpdate({ _id: consentId, companyId }, { $set: { withdrawnAt: new Date(), withdrawnBy: by } }, { new: true }).lean<any>();
}

/** The latest acceptance for a person, by whichever handle is known. */
export async function consentOf(companyId: any, who: { email?: string; phone?: string; visitorId?: string }) {
  const or: any[] = [];
  if (who.email) or.push({ email: who.email.toLowerCase() });
  if (who.phone) or.push({ phone: who.phone });
  if (who.visitorId) or.push({ visitorId: who.visitorId });
  if (!or.length) return null;
  return DpdpConsent.findOne({ companyId, $or: or }).sort({ acceptedAt: -1 }).lean<any>();
}

/** Records what a visitor chose in the cookie banner. */
export async function cookieChoice(companyId: any, input: { visitorId: string; categories: Record<string, boolean>; choice?: string; page?: string; ip?: string; userAgent?: string; policyVersion?: number }) {
  return CookieConsent.create({
    companyId,
    visitorId: input.visitorId,
    categories: { ...input.categories, necessary: true },
    choice: input.choice || "custom",
    page: input.page,
    ip: input.ip,
    userAgent: input.userAgent,
    policyVersion: input.policyVersion,
    decidedAt: new Date(),
  });
}

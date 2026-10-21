import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { randomKey } from "./crypto";
import { HttpError } from "./http";

let client: S3Client | null = null;
function s3() {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || "ap-south-1",
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  return client;
}
const bucket = () => {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not set");
  return b;
};

export function publicUrl(key: string) {
  const base = process.env.S3_PUBLIC_BASE_URL || `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION || "ap-south-1"}.amazonaws.com`;
  return `${base.replace(/\/$/, "")}/${encKey(key)}`;
}
const encKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/** Optional root for every company folder (S3_BASE_PATH, e.g. "lms/prod"); empty = bucket root. */
const basePath = () => (process.env.S3_BASE_PATH || "").replace(/^\/+|\/+$/g, "");
/** One path segment S3 can hold (codes, client IDs, attachment types like "Profile Photo"). */
export const seg = (s: string) =>
  String(s || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f/\\{}^%`\[\]"<>~#|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 100) || "_";

/** The company's folder: <base path>/<Company Code>  (e.g. "WHD"). */
export function companyFolder(code: string) {
  return [basePath(), seg(String(code || "company").toUpperCase())].filter(Boolean).join("/");
}

/** Thrown when Super Admin has switched S3 off for the company (Company › Web address & storage). */
export class S3OffError extends HttpError {
  constructor() {
    super(409, "File storage (S3) is turned off for this company. Ask your Super Admin to tick “S3 storage required” in Company › Edit.");
  }
}

/** The company's base folder — refuses when S3 is switched off for it. */
export async function folderFor(company: any): Promise<string> {
  if (company?.s3Enabled === false) throw new S3OffError();
  const folder = companyFolder(company.code);
  if (company.s3Folder !== folder) {
    const { Company } = await import("../models");
    await Company.updateOne({ _id: company._id }, { $set: { s3Folder: folder } });
    company.s3Folder = folder;
  }
  return folder;
}

/** Creates the company's folder tree in S3 (zero-byte "folder" markers): <code>/, logo/, banner/, brain/. Idempotent. */
export async function ensureCompanyFolder(company: any) {
  if (!process.env.S3_BUCKET) return null;
  const folder = await folderFor(company);
  for (const k of ["", "logo/", "banner/", "brain/"]) await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: `${folder}/${k}`, Body: "", ServerSideEncryption: "AES256" }));
  const { Company } = await import("../models");
  await Company.updateOne({ _id: company._id }, { $set: { s3CreatedAt: new Date() } });
  return folder;
}

/** Where a client's attachments of one type live: <base path>/<Company Code>/<Client Code>/<Attachment Type>/ */
export async function attachmentFolder(company: any, clientCode: string, type: string) {
  return `${await folderFor(company)}/${seg(clientCode)}/${seg(type)}`;
}

/**
 * Layout:  <base>/<Company Code>/logo/…  /banner/…  /brain/… (knowledge base)  /<Client Code>/<Attachment Type>/…
 * Objects are encrypted at rest (SSE-S3) and the bucket stays private — files are served through the API.
 */
export async function putObject(prefix: string, fileName: string, body: Buffer | string, contentType = "application/octet-stream") {
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-120);
  const key = `${prefix.replace(/\/+$/, "")}/${Date.now()}-${randomKey(4)}-${safe}`;
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType, ServerSideEncryption: "AES256", CacheControl: "private, max-age=31536000, immutable" }));
  return { key, url: publicUrl(key) };
}

export async function getObjectText(key: string) {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return (await r.Body?.transformToString("utf-8")) || "";
}

/** Raw object for streaming through the API (keeps the bucket private). */
export async function getObject(key: string) {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = await r.Body?.transformToByteArray();
  return { body: Buffer.from(bytes || []), contentType: r.ContentType || "application/octet-stream", etag: r.ETag };
}

async function moveObject(from: string, to: string) {
  await s3().send(new CopyObjectCommand({ Bucket: bucket(), CopySource: `${bucket()}/${encKey(from)}`, Key: to, ServerSideEncryption: "AES256", MetadataDirective: "COPY" }));
  await deleteObject(from);
}
const fileOf = (key: string) => key.split("/").pop() || key;

/**
 * Moves a company's existing files into  <base>/<Company Code>/logo · /banner · /brain  (idempotent; safe to re-run).
 * Covers the earlier company-name folders. Skipped for companies with S3 switched off.
 */
export async function relayoutCompany(companyId: any) {
  if (!process.env.S3_BUCKET) return { moved: 0 };
  const { Company, CompanyAgent } = await import("../models");
  const c: any = await Company.findById(companyId);
  if (!c || c.s3Enabled === false) return { moved: 0 };
  const folder = await folderFor(c);
  let moved = 0;
  const target = (key: string, sub: string) => (key.startsWith(`${folder}/${sub}/`) ? null : `${folder}/${sub}/${fileOf(key)}`);
  for (const kind of ["logo", "banner", "favicon"]) {
    const key = c.branding?.[`${kind}Key`];
    const to = key && target(key, kind === "banner" ? "banner" : "logo");
    if (!to) continue;
    try {
      await moveObject(key, to);
      c.set(`branding.${kind}Key`, to);
      moved++;
    } catch (e: any) {
      console.warn("S3 move failed", key, e?.message);
    }
  }
  if (moved) await c.save();
  const { inCompanyDb } = await import("./tenantdb");
  await inCompanyDb(c._id, async () => {
  for (const ca of await CompanyAgent.find({ companyId: c._id })) {
    let dirty = false;
    for (const k of ca.knowledge || []) {
      for (const [field, sub] of [["key", "brain"], ["extractedKey", "brain/_extracted"]] as const) {
        const to = k[field] && target(k[field], sub);
        if (!to) continue;
        try {
          await moveObject(k[field], to);
          k[field] = to;
          if (field === "key") k.url = publicUrl(to);
          dirty = true;
          moved++;
        } catch (e: any) {
          console.warn("S3 move failed", k[field], e?.message);
        }
      }
    }
    if (dirty) {
      ca.markModified("knowledge");
      await ca.save();
    }
  }
  // client attachments → <folder>/<Client Code>/<Attachment Type>/
  const { ClientPayment } = await import("../models");
  for (const p of await ClientPayment.find({ companyId: c._id, "attachments.0": { $exists: true } })) {
    let dirty = false;
    for (const at of p.attachments || []) {
      const want = `${folder}/${seg(p.clientCode)}/${seg(at.type || "Payment")}/`;
      if (!at.key || at.key.startsWith(want)) continue;
      try {
        const to = want + fileOf(at.key);
        await moveObject(at.key, to);
        at.key = to;
        dirty = true;
        moved++;
      } catch (e: any) {
        console.warn("S3 move failed", at.key, e?.message);
      }
    }
    if (dirty) {
      p.markModified("attachments");
      await p.save();
    }
  }
  });
  return { folder, moved };
}

export async function relayoutAll() {
  const { Company } = await import("../models");
  let moved = 0;
  for (const c of await Company.find({ deletedAt: null }).select("_id").lean<any[]>()) moved += (await relayoutCompany(c._id)).moved;
  return { moved };
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => undefined);
}

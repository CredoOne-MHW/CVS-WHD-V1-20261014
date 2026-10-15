import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { randomKey } from "./crypto";

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

/** Base folder = the company name exactly as typed ("WELLNESSHIVE DIAGNOSTICA LLP"); only characters S3 can't hold in a folder name are dropped. */
export function companyFolder(name: string) {
  return (
    name
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f/\\{}^%`\[\]"<>~#|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+$/, "")
      .slice(0, 100) || "company"
  );
}
/** Folder style used before Oct 2026 ("WELLNESSHIVE-DIAGNOSTICA-LLP") — migrated to the exact name. */
function legacyFolder(name: string) {
  return name.normalize("NFKD").replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80) || "company";
}

/** Ensures the company has its fixed base folder (older companies get one on first upload). */
export async function folderFor(company: any): Promise<string> {
  if (company.s3Folder && company.s3Folder !== legacyFolder(company.name)) return company.s3Folder;
  if (company.s3Folder && company.s3Folder === companyFolder(company.name)) return company.s3Folder;
  const { Company } = await import("../models");
  const base = companyFolder(company.name);
  let folder = base;
  for (let i = 2; await Company.exists({ s3Folder: folder, _id: { $ne: company._id } }); i++) folder = `${base}-${i}`;
  await Company.updateOne({ _id: company._id }, { $set: { s3Folder: folder } });
  company.s3Folder = folder;
  return folder;
}

/**
 * Layout:  <Company-Name>/logo/…   <Company-Name>/banner/…   <Company-Name>/brain/…   (knowledge base)
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
 * Moves a company's existing files into  <Company Name>/logo · /banner · /brain  (idempotent; safe to re-run).
 * Covers companies created before the folder layout and the earlier hyphenated folder names.
 */
export async function relayoutCompany(companyId: any) {
  if (!process.env.S3_BUCKET) return { moved: 0 };
  const { Company, CompanyAgent } = await import("../models");
  const c: any = await Company.findById(companyId);
  if (!c) return { moved: 0 };
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

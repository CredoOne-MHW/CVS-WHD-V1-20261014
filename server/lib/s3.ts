import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
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
  return `${base.replace(/\/$/, "")}/${key}`;
}

/** "Wellnesshive Diagnostica LLP" → "Wellnesshive-Diagnostica-LLP" (S3-safe, readable in the console). */
export function companyFolder(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "company"
  );
}

/** Ensures the company has its fixed base folder (older companies get one on first upload). */
export async function folderFor(company: any): Promise<string> {
  if (company.s3Folder) return company.s3Folder;
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

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => undefined);
}

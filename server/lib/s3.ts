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

/** Keys are always tenant-prefixed: companies/<id>/<folder>/<rand>-<name> */
export async function putObject(companyId: string, folder: string, fileName: string, body: Buffer | string, contentType = "application/octet-stream") {
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-120);
  const key = `companies/${companyId}/${folder}/${Date.now()}-${randomKey(4)}-${safe}`;
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
  return { key, url: publicUrl(key) };
}

export async function getObjectText(key: string) {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return (await r.Body?.transformToString("utf-8")) || "";
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => undefined);
}

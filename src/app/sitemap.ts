import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost";
  return [{ url: `https://${host}/login`, changeFrequency: "monthly", priority: 1 }];
}

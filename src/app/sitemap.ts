import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default function sitemap(): MetadataRoute.Sitemap {
  const host = headers().get("x-forwarded-host") || headers().get("host") || "localhost";
  return [{ url: `https://${host}/login`, changeFrequency: "monthly", priority: 1 }];
}

import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/** Per-host robots: only the public login and campaign forms are crawlable; consoles and API never are. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  return {
    rules: [{ userAgent: "*", allow: ["/login", "/f/"], disallow: ["/sa", "/app", "/api"] }],
    sitemap: host ? `https://${host}/sitemap.xml` : undefined,
    host: host ? `https://${host}` : undefined,
  };
}

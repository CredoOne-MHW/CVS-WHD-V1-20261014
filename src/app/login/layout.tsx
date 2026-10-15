import type { Metadata } from "next";
import { headers } from "next/headers";
import { initialsIcon } from "@shared/theme";

export const dynamic = "force-dynamic";

/** Per-address SEO / AEO: the title, description, Open Graph card and structured data follow the company that owns the address. */
async function brandFor(host: string) {
  try {
    const { connectDB } = await import("../../../server/lib/db");
    const { resolveHost, publicBranding, platformBranding } = await import("../../../server/lib/tenant");
    await connectDB();
    const t = await resolveHost(host);
    return t.kind === "company" ? publicBranding(t.company) : platformBranding();
  } catch {
    const { platformBranding } = await import("../../../server/lib/tenant");
    return platformBranding();
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const host = headers().get("x-forwarded-host") || headers().get("host") || "";
  const b = await brandFor(host);
  const title = b.kind === "company" ? `Sign in · ${b.shortName}` : `${b.name} · ${b.tagline}`;
  const description = b.kind === "company" ? `${b.shortName}${b.tagline ? ` — ${b.tagline}` : ""}. Secure sign-in for the ${b.shortName} team.` : b.subheadline;
  const url = host ? `https://${host}/login` : undefined;
  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    robots: { index: true, follow: false },
    openGraph: { title, description, url, siteName: b.shortName, type: "website", images: b.logoUrl ? [{ url: b.logoUrl }] : undefined },
    twitter: { card: "summary", title, description },
    icons: { icon: (b as any).faviconUrl || b.logoUrl || initialsIcon(b.shortName, b.themeColor) },
    other: { "theme-color": b.themeColor },
  };
}

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const host = headers().get("x-forwarded-host") || headers().get("host") || "";
  const b = await brandFor(host);
  // Structured data for search and answer engines (AEO)
  const jsonLd =
    b.kind === "company"
      ? { "@context": "https://schema.org", "@type": "Organization", name: b.name, alternateName: b.shortName, description: b.tagline || undefined, url: host ? `https://${host}` : undefined, logo: b.logoUrl && host ? `https://${host}${b.logoUrl}` : undefined, email: (b as any).supportEmail || undefined, telephone: (b as any).supportPhone || undefined }
      : {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: `${b.name} ${b.tagline}`,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: b.subheadline,
          publisher: { "@type": "Organization", name: "Credovation Solutions Pvt Ltd", address: { "@type": "PostalAddress", addressLocality: "Kolkata", addressRegion: "West Bengal", addressCountry: "IN" } },
        };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {children}
    </>
  );
}

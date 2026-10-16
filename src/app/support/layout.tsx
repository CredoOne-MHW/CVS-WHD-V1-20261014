import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

async function brandFor(host: string) {
  try {
    const { connectDB } = await import("../../../server/lib/db");
    const { resolveHost, publicBranding } = await import("../../../server/lib/tenant");
    await connectDB();
    const t = await resolveHost(host.split(":")[0].toLowerCase());
    return t.kind === "company" ? publicBranding(t.company) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const host = headers().get("x-forwarded-host") || headers().get("host") || "";
  const b = await brandFor(host);
  const title = b ? `Support · ${b.shortName}` : "Support";
  return {
    title,
    description: b ? `Raise a support request with ${b.shortName} and follow its status.` : "Raise a support request and follow its status.",
    manifest: "/support/manifest.webmanifest",
    robots: { index: false, follow: false },
    icons: b?.faviconUrl || b?.logoUrl ? { icon: (b!.faviconUrl || b!.logoUrl)!, apple: b!.logoUrl } : { icon: "/support-icon.svg" },
    appleWebApp: { capable: true, title: b?.shortName || "Support", statusBarStyle: "default" },
  };
}
export async function generateViewport(): Promise<Viewport> {
  const host = headers().get("x-forwarded-host") || headers().get("host") || "";
  const b = await brandFor(host);
  return { themeColor: b?.themeColor || "#2f5c24", width: "device-width", initialScale: 1, viewportFit: "cover" };
}

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children;
}

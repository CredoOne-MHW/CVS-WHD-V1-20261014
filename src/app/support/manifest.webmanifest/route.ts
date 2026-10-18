import { headers } from "next/headers";

export const dynamic = "force-dynamic";

/** Per-company PWA manifest for the support portal (name, colours and icon follow the company's branding). */
export async function GET() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  let name = "Support";
  let short = "Support";
  let color = "#2f5c24";
  let icon: string | undefined;
  try {
    const { connectDB } = await import("../../../../server/lib/db");
    const { resolveHost, publicBranding } = await import("../../../../server/lib/tenant");
    await connectDB();
    const t = await resolveHost(host.split(":")[0].toLowerCase());
    if (t.kind === "company") {
      const b = publicBranding(t.company);
      name = `${b.shortName} Support`;
      short = `${b.shortName}`.slice(0, 12);
      color = b.themeColor;
      icon = b.logoUrl;
    }
  } catch {
    /* defaults */
  }
  const onSupportHost = host.toLowerCase().startsWith("support.");
  const body = {
    name,
    short_name: short,
    description: "Raise a support request and follow its status",
    start_url: onSupportHost ? "/" : "/support",
    scope: onSupportHost ? "/" : "/support",
    display: "standalone",
    background_color: "#f6f7f5",
    theme_color: color,
    icons: icon
      ? [
          { src: icon, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: icon, sizes: "512x512", type: "image/png", purpose: "any" },
        ]
      : [{ src: "/support-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=300" } });
}

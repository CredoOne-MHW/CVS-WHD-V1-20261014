import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: `${process.env.NEXT_PUBLIC_BRAND_NAME || "Wellness Hive"} · Lead Management`,
  description: "Capture, qualify and convert leads from every channel.",
};
export const viewport: Viewport = { themeColor: "#2f5c24", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
      </head>
      <body className="font-sans" style={{ ["--font-sans" as any]: "'Plus Jakarta Sans'" }}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// self-hosted (no third-party request, preloaded, no layout shift): Plus Jakarta Sans variable, Latin, SIL OFL
const jakarta = localFont({ src: "../fonts/plus-jakarta-sans-latin-wght-normal.woff2", weight: "200 800", display: "swap", variable: "--font-jakarta", fallback: ["system-ui", "Segoe UI", "Roboto", "sans-serif"] });
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: `${process.env.NEXT_PUBLIC_BRAND_NAME || "Wellness Hive"} · Lead Management`,
  description: "Capture, qualify and convert leads from every channel.",
};
export const viewport: Viewport = { themeColor: "#2f5c24", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <head>
        {/* Extensions (Grammarly, Microsoft Editor, password managers, page translators) move DOM nodes React owns;
            React then throws "removeChild/insertBefore: not a child" and the whole page dies. Make those calls tolerant. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof Node!=="function"||!Node.prototype||Node.prototype.__lmsSafe)return;var r=Node.prototype.removeChild,i=Node.prototype.insertBefore;Node.prototype.removeChild=function(c){if(c&&c.parentNode!==this){if(c.parentNode)return c.parentNode.removeChild(c);return c}return r.apply(this,arguments)};Node.prototype.insertBefore=function(n,ref){if(ref&&ref.parentNode!==this){return this.appendChild(n)}return i.apply(this,arguments)};Node.prototype.__lmsSafe=true})();`,
          }}
        />
      </head>
      <body className="font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

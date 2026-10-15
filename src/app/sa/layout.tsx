import type { Metadata } from "next";
import Shell from "@/components/Shell";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <Shell scope="super">{children}</Shell>;
}

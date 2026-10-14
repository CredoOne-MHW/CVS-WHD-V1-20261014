import Shell from "@/components/Shell";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <Shell scope="company">{children}</Shell>;
}

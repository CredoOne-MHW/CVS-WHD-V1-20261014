"use client";
import { useState } from "react";
import { PageHeader, Empty } from "@/components/ui";
import { Tabs } from "@/components/Logs";
import { ReportBuilder, AgenticReport } from "@/components/Reports";
import { usePerm } from "@/components/Shell";

export default function Page() {
  const [pick, setTab] = useState<"diy" | "ai">("diy");
  // DIY and Agentic are separate sub-modules in Role Management.
  const diy = usePerm("reports:builder"), ai = usePerm("reports:ai");
  const tabs = [diy.read && { key: "diy" as const, label: "DIY Report" }, ai.read && { key: "ai" as const, label: "Agentic Report" }].filter(Boolean) as { key: "diy" | "ai"; label: string }[];
  const tab = tabs.some((t) => t.key === pick) ? pick : tabs[0]?.key;
  return (
    <>
      <PageHeader title="Report" subtitle="Build reports yourself, or ask an AI agent in plain language. Export to Excel or CSV." />
      {tabs.length > 1 && <Tabs value={tab!} onChange={setTab} tabs={tabs} />}
      {tab === "diy" ? <ReportBuilder base="/co" /> : tab === "ai" ? <AgenticReport /> : <Empty title="No access" hint="Your role has no access to DIY or Agentic reports." />}
    </>
  );
}

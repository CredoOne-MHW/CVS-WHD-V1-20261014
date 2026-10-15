"use client";
import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { Tabs } from "@/components/Logs";
import { ReportBuilder, AgenticReport } from "@/components/Reports";
export default function Page() {
  const [tab, setTab] = useState<"diy" | "ai">("diy");
  return (
    <>
      <PageHeader title="Report" subtitle="Build reports yourself, or ask an AI agent in plain language. Export to Excel or CSV." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "diy", label: "DIY Report" }, { key: "ai", label: "Agentic Report" }]} />
      {tab === "diy" ? <ReportBuilder base="/co" /> : <AgenticReport />}
    </>
  );
}

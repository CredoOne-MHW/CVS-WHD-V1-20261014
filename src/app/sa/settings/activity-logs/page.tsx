"use client";
import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { ActivityLogs, Tabs } from "@/components/Logs";
export default function Page() {
  const [side, setSide] = useState<"super" | "company">("super");
  return (
    <>
      <PageHeader title="Activity Logs" subtitle="Every create, update, delete, login and send — with the request payload." />
      <Tabs value={side} onChange={setSide} tabs={[{ key: "super", label: "Super Admin side" }, { key: "company", label: "Company user side" }]} />
      <ActivityLogs key={side} base="/sa" side={side} companyFilter={side === "company"} />
    </>
  );
}

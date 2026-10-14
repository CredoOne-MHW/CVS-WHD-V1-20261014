"use client";
import { PageHeader } from "@/components/ui";
import { ActivityLogs } from "@/components/Logs";
export default function Page() {
  return (
    <>
      <PageHeader title="Activity Logs" subtitle="Who did what, when — across your workspace." />
      <ActivityLogs base="/co" />
    </>
  );
}

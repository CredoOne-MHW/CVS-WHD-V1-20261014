"use client";
import { PageHeader } from "@/components/ui";
import { ReportBuilder } from "@/components/Reports";
export default function Page() {
  return (
    <>
      <PageHeader title="Report" subtitle="Build any report across companies — summaries or detailed lists — and export to Excel or CSV." />
      <ReportBuilder base="/sa" />
    </>
  );
}

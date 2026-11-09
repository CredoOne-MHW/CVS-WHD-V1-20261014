"use client";
import { PageHeader } from "@/components/ui";
import { WaLogs } from "@/components/Logs";
export default function Page() {
  return (
    <>
      <PageHeader title="WhatsApp Logs" subtitle="Every WhatsApp message sent, with status and resend." />
      <WaLogs base="/co" />
    </>
  );
}

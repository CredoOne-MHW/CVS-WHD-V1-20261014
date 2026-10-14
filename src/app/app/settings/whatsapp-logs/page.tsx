"use client";
import { PageHeader } from "@/components/ui";
import { WaLogs } from "@/components/Logs";
export default function Page() {
  return (
    <>
      <PageHeader title="WhatsApp Logs" subtitle="Delivery result of every WhatsApp message. Open the payload or resend." />
      <WaLogs base="/co" />
    </>
  );
}

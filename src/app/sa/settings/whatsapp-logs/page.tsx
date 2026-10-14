"use client";
import { PageHeader } from "@/components/ui";
import { WaLogs } from "@/components/Logs";
export default function Page() {
  return (
    <>
      <PageHeader title="WhatsApp Logs" subtitle="Every message sent from Super Admin webhooks." />
      <WaLogs base="/sa" />
    </>
  );
}

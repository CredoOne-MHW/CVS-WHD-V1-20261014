"use client";
import { PageHeader } from "@/components/ui";
import { WebhookBoard } from "@/components/Webhooks";
export default function Page() {
  return (
    <>
      <PageHeader title="WhatsApp Webhook" subtitle="Platform messages to companies — reminders, welcome, deactivation, low credits." />
      <WebhookBoard base="/sa" createAlign="left" />
    </>
  );
}

"use client";
import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { ActivityLogs, Tabs } from "@/components/Logs";
import { Dpdp } from "@/components/Dpdp";
import { usePerm } from "@/components/Shell";

/** Activity is the platform's own log; DPDP is the consent evidence the Act asks a company to keep. */
export default function Page() {
  const [tab, setTab] = useState<"activity" | "dpdp">("activity");
  const dpdp = usePerm("activity_logs:dpdp");
  return (
    <>
      <PageHeader title="Logs" subtitle="Who did what, when — and who accepted your data-protection notice." />
      {dpdp.read ? (
        <Tabs value={tab} onChange={setTab} tabs={[{ key: "activity" as const, label: "Activity" }, { key: "dpdp" as const, label: "DPDP" }]} />
      ) : null}
      {tab === "activity" || !dpdp.read ? <ActivityLogs base="/co" /> : <Dpdp base="/co" canEdit={false} />}
    </>
  );
}

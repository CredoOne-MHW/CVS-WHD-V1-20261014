"use client";
import { PageHeader } from "@/components/ui";
import { Dpdp } from "@/components/Dpdp";
import { usePerm } from "@/components/Shell";

export default function Page() {
  const perm = usePerm("dpdp:document");
  return (
    <>
      <PageHeader title="DPDP" subtitle="The consent notice your visitors must read, who accepted it, and what they chose about cookies." />
      <Dpdp base="/co" canEdit={perm.update} />
    </>
  );
}

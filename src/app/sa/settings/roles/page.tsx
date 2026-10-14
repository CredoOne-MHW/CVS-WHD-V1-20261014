"use client";
import { PageHeader } from "@/components/ui";
import { RoleManager } from "@/components/Roles";
export default function Page() {
  return (
    <>
      <PageHeader title="Role Management" subtitle="Role templates per plan. Every Company module appears here automatically; boxes outside the plan are locked." />
      <RoleManager base="/sa" />
    </>
  );
}

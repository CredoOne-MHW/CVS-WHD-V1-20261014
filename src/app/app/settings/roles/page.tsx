"use client";
import { PageHeader } from "@/components/ui";
import { RoleManager } from "@/components/Roles";
export default function Page() {
  return (
    <>
      <PageHeader title="Role Management" subtitle="Create roles for your team within what your plan allows, then assign users." />
      <RoleManager base="/co" />
    </>
  );
}

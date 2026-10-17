"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Users, KanbanSquare, LifeBuoy, CreditCard } from "lucide-react";
import { PageHeader, Spinner } from "@/components/ui";
import dynamic from "next/dynamic";

// each tab's code loads only when that tab is opened
const TabLoading = () => (
  <div className="flex justify-center py-16 text-hive-700">
    <Spinner className="h-6 w-6" />
  </div>
);
const ClientList = dynamic(() => import("@/components/clients/ClientList").then((m) => m.ClientList), { loading: TabLoading });
const Board = dynamic(() => import("@/components/clients/Board").then((m) => m.Board), { loading: TabLoading });
const Tickets = dynamic(() => import("@/components/clients/Tickets").then((m) => m.Tickets), { loading: TabLoading });
const Billing = dynamic(() => import("@/components/clients/Billing").then((m) => m.Billing), { loading: TabLoading });

const TABS = [
  { key: "clients", label: "Clients", Icon: Users, sub: "Every converted lead, with its full journey" },
  { key: "board", label: "Service Board", Icon: KanbanSquare, sub: "Drag clients between service statuses — edit the columns any time" },
  { key: "support", label: "Support Tickets", Icon: LifeBuoy, sub: "Requests and grievances from the client support page" },
  { key: "subscription", label: "Subscription Management", Icon: CreditCard, sub: "Payment details, dues and transaction history" },
] as const;

function ClientsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.key === sp?.get("tab"))?.key || "clients") as (typeof TABS)[number]["key"];
  const cur = TABS.find((t) => t.key === tab)!;
  return (
    <>
      <PageHeader title="Client" subtitle={cur.sub} />
      <nav className="no-scrollbar mb-5 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_rgba(122,133,119,0.18)]" aria-label="Client sections">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => router.replace(key === "clients" ? "/app/clients" : `/app/clients?tab=${key}`, { scroll: false })}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === key ? "border-hive-700 text-hive-800" : "border-transparent text-ink-500 hover:text-ink-900"}`}
            aria-current={tab === key ? "page" : undefined}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </nav>
      {tab === "clients" && <ClientList />}
      {tab === "board" && <Board />}
      {tab === "support" && <Tickets />}
      {tab === "subscription" && <Billing />}
    </>
  );
}

export default function Clients() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <ClientsInner />
    </Suspense>
  );
}

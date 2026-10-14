"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtDate, inr } from "@/lib/api";
import { PageHeader, Stat, BarList, Columns, Badge, Spinner } from "@/components/ui";

export default function SaDashboard() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    api("/sa/dashboard").then(setD);
  }, []);
  if (!d)
    return (
      <div className="flex justify-center py-24 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  const companies = d.byStatus.reduce((s: number, x: any) => s + x.n, 0);
  const active = d.byStatus.find((x: any) => x._id === "active")?.n || 0;
  const waOk = d.wa.find((x: any) => x._id === "success")?.n || 0;
  const waFail = d.wa.find((x: any) => x._id === "failed")?.n || 0;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Platform health across all companies · last 30 days" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Companies" value={companies} hint={`${active} active · ${companies - active} inactive`} />
        <Stat label="Leads captured" value={d.leads30.toLocaleString("en-IN")} hint={`${d.totalLeads.toLocaleString("en-IN")} all time`} tone="honey" />
        <Stat label="WhatsApp messages" value={(waOk + waFail).toLocaleString("en-IN")} hint={`${waFail} failed`} tone={waFail > waOk * 0.05 ? "red" : "green"} />
        <Stat label="AI credits used" value={d.ai.credits.toFixed(1)} hint={`Billed ${inr(d.ai.billed)} · cost ${inr(d.ai.cost)}`} tone="gray" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="card p-6 xl:col-span-2">
          <h2 className="mb-4 font-bold">Leads per day (all companies)</h2>
          <Columns data={d.trend} />
        </div>
        <div className="card p-6">
          <h2 className="mb-4 font-bold">Companies by plan</h2>
          <BarList rows={d.byPlan.map((p: any) => ({ label: p._id, value: p.n }))} color="bg-honey-500" />
        </div>
        <div className="card p-6">
          <h2 className="mb-4 font-bold">Top companies by leads</h2>
          <BarList rows={d.topCompanies.map((c: any) => ({ label: c.name || "—", value: c.leads, sub: `${c.won} converted` }))} />
        </div>
        <div className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between p-6 pb-3">
            <h2 className="font-bold">Recently onboarded</h2>
            <Link href="/sa/companies" className="text-sm font-semibold text-hive-700">
              View all →
            </Link>
          </div>
          <table className="w-full">
            <tbody>
              {d.recent.map((c: any) => (
                <tr key={c._id}>
                  <td className="td font-semibold">
                    {c.name} <span className="mono text-ink-400">{c.code}</span>
                  </td>
                  <td className="td">
                    <Badge color="honey">{c.plan}</Badge>
                  </td>
                  <td className="td">
                    <Badge color={c.status === "active" ? "green" : "red"}>{c.status}</Badge>
                  </td>
                  <td className="td text-right text-ink-500">{fmtDate(c.createdAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

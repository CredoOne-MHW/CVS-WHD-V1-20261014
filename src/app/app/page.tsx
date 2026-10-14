"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtDate } from "@/lib/api";
import { PageHeader, Stat, BarList, Columns, Badge, Spinner } from "@/components/ui";
import { LEAD_STATUSES } from "@shared/constants";

export default function CompanyDashboard() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    setD(null);
    api(`/co/dashboard?days=${days}`).then(setD);
  }, [days]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Pipeline, sources and today's follow-ups"
        actions={
          <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </select>
        }
      />
      {!d ? (
        <div className="flex justify-center py-24 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Leads captured" value={d.total.toLocaleString("en-IN")} hint={`${d.today} today`} />
            <Stat label="Not yet contacted" value={d.untouched} hint="Status: New" tone={d.untouched > 10 ? "red" : "honey"} />
            <Stat label="Converted" value={d.won} hint={`${d.conversion}% conversion`} />
            <Stat label="Lost" value={d.lost} hint={d.lostReasons[0] ? `Top reason: ${d.lostReasons[0]._id}` : "—"} tone="gray" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <div className="card p-6 xl:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-bold">Leads per day</h2>
                <span className="flex items-center gap-3 text-xs text-ink-500">
                  <span className="flex items-center gap-1">
                    <i className="h-2.5 w-2.5 rounded-sm bg-hive-200" /> captured
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="h-2.5 w-2.5 rounded-sm bg-hive-600" /> converted
                  </span>
                </span>
              </div>
              <Columns data={d.trend} />
            </div>
            <div className="card p-6">
              <h2 className="mb-4 font-bold">Follow-ups due</h2>
              {d.dueFollowups.length ? (
                <ul className="divide-y divide-ink-400/10">
                  {d.dueFollowups.map((l: any) => (
                    <li key={l._id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{l.name || l.phone}</p>
                        <p className="text-xs text-ink-500">{l.nextFollowUpAt ? fmtDate(l.nextFollowUpAt) : l.source}</p>
                      </div>
                      <Badge color="honey">{l.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-sm text-ink-400">Nothing due. Nice.</p>
              )}
              <Link href="/app/leads?status=Follow-ups%20needed" className="mt-3 inline-block text-sm font-semibold text-hive-700">
                Open follow-ups →
              </Link>
            </div>

            <div className="card p-6">
              <h2 className="mb-4 font-bold">Pipeline</h2>
              <BarList rows={LEAD_STATUSES.map((s) => ({ label: s, value: d.funnel.find((f: any) => f._id === s)?.n || 0 })).filter((r) => r.value > 0)} />
            </div>
            <div className="card p-6">
              <h2 className="mb-4 font-bold">Sources</h2>
              <BarList rows={d.sources.map((s: any) => ({ label: s._id || "unknown", value: s.n, sub: `${s.n ? Math.round((s.won / s.n) * 100) : 0}% conv.` }))} color="bg-honey-500" />
            </div>
            <div className="card p-6">
              <h2 className="mb-4 font-bold">Lost reasons</h2>
              <BarList rows={d.lostReasons.map((s: any) => ({ label: s._id || "Unspecified", value: s.n }))} color="bg-red-400" empty="No lost leads in this period" />
            </div>
          </div>
        </>
      )}
    </>
  );
}

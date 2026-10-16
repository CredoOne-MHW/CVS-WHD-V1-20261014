"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, RefreshCw, ExternalLink, CircleCheck, CircleDashed, CircleAlert, Globe2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Badge, Btn, Modal, Spinner, useToast } from "./ui";

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost shrink-0"
      aria-label="Copy value"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {ok ? <Check className="h-4 w-4 text-hive-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

const STATUS = {
  ok: { Icon: CircleCheck, cls: "text-hive-600", label: "Found" },
  pending: { Icon: CircleDashed, cls: "text-ink-400", label: "Not found yet" },
  conflict: { Icon: CircleAlert, cls: "text-red-600", label: "Different value" },
} as const;

/** DNS records + live status for one company's white-label domain. */
export function DnsPanel({ companyId, autoCheck = false }: { companyId: string; autoCheck?: boolean }) {
  const [rep, setRep] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const check = async () => {
    setBusy(true);
    try {
      setRep(await api(`/sa/companies/${companyId}/domain/check`, { method: "POST" }));
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    api(`/sa/companies/${companyId}/domain`).then((r) => {
      setRep(r);
      if (autoCheck && r.company.customDomain) check();
    });
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rep)
    return (
      <div className="flex justify-center py-12 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-ink-400/15 bg-gradient-to-br from-hive-50 to-white p-4">
          <p className="eyebrow text-ink-500">Platform URL · live now</p>
          {rep.platformUrl ? (
            <a href={rep.platformUrl} target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1.5 break-all font-mono text-[13.5px] font-semibold text-hive-800 hover:underline">
              {rep.platformUrl.replace("https://", "")} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : (
            <p className="mt-1.5 text-sm text-ink-500">Set APP_BASE_DOMAIN to enable sub-domains.</p>
          )}
          <p className="mt-2 text-xs text-ink-500">Works as soon as the one-time wildcard setup for {rep.baseDomain || "the base domain"} is done.</p>
        </div>
        <div className="rounded-2xl border border-ink-400/15 p-4">
          <p className="eyebrow text-ink-500">Company’s own URL</p>
          {rep.customUrl ? (
            <>
              <p className="mt-1.5 break-all font-mono text-[13.5px] font-semibold">{rep.customUrl.replace("https://", "")}</p>
              <div className="mt-2">{rep.ready ? <Badge color="green">Live · SSL issued automatically</Badge> : <Badge color="honey">Waiting for DNS</Badge>}</div>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-ink-500">Optional. Add a domain in the company’s Branding section to get DNS records.</p>
          )}
        </div>
      </div>

      {rep.support && (
        <div className="rounded-2xl border border-ink-400/15 p-4">
          <p className="eyebrow text-ink-500">Client support portal</p>
          <p className="mt-1 text-xs text-ink-500">Clients raise Support / Request / Grievance tickets here. Works right away at the path address; the support.… addresses need one DNS record each.</p>
          {rep.support.fallbackUrl && (
            <a href={rep.support.fallbackUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1.5 break-all font-mono text-[13px] font-semibold text-hive-800 hover:underline">
              {rep.support.fallbackUrl.replace("https://", "")} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="text-ink-500">
                  <th className="py-1.5 pr-3 font-semibold">Address</th>
                  <th className="py-1.5 pr-3 font-semibold">Type</th>
                  <th className="py-1.5 pr-3 font-semibold">Host (at {"the DNS provider"})</th>
                  <th className="py-1.5 pr-3 font-semibold">Points to</th>
                  <th className="py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rep.support.records.map((r: any) => (
                  <tr key={r.fqdn} className="border-t border-ink-400/10">
                    <td className="py-2 pr-3 font-mono">{r.fqdn}</td>
                    <td className="py-2 pr-3 font-mono">CNAME</td>
                    <td className="py-2 pr-3 font-mono">{r.host}</td>
                    <td className="py-2 pr-3 font-mono">{r.value}</td>
                    <td className="py-2">{r.status === "ok" ? <Badge color="green">Live</Badge> : r.status === "conflict" ? <Badge color="red">Points elsewhere</Badge> : <Badge color="honey">{r.status ? "Waiting for DNS" : "Not checked"}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rep.company.customDomain && (
        <>
          <div>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-bold">Add these records at the domain’s DNS provider</h3>
                <p className="text-sm text-ink-500">
                  DNS zone: <span className="mono font-semibold text-ink-700">{rep.zone}</span> · GoDaddy, Hostinger, BigRock, Cloudflare, Route 53…
                </p>
              </div>
              <Btn variant="secondary" onClick={check} loading={busy}>
                <RefreshCw className="h-4 w-4" /> Check DNS now
              </Btn>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-ink-400/15">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    {["Type", "Host / Name", "Value / Points to", "TTL", "Status"].map((h) => (
                      <th key={h} className="th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rep.records.map((r: any, i: number) => {
                    const st = r.status ? STATUS[r.status as keyof typeof STATUS] : null;
                    return (
                      <tr key={i} className={r.required ? "" : "bg-[#fafbf9]"}>
                        <td className="td">
                          <span className="rounded-md bg-hive-900 px-2 py-0.5 font-mono text-[11.5px] font-bold text-white">{r.type}</span>
                          {!r.required && <p className="mt-1 text-[11px] text-ink-400">optional</p>}
                          {r.unique && <p className="mt-1 text-[11px] font-semibold text-hive-700">unique to this company</p>}
                        </td>
                        <td className="td">
                          <div className="flex items-center gap-1">
                            <code className="mono font-semibold">{r.host}</code>
                            <CopyBtn text={r.host} />
                          </div>
                        </td>
                        <td className="td">
                          <div className="flex items-center gap-1">
                            <code className="mono break-all">{r.value}</code>
                            <CopyBtn text={r.value} />
                          </div>
                          <p className="mt-1 text-xs text-ink-500">{r.purpose}</p>
                        </td>
                        <td className="td text-ink-500">{r.ttl}</td>
                        <td className="td whitespace-nowrap">
                          {st ? (
                            <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${st.cls}`}>
                              <st.Icon className="h-4 w-4" /> {st.label}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-400">Not checked</span>
                          )}
                          {r.found?.length > 0 && r.status !== "ok" && <p className="mt-1 max-w-[180px] truncate font-mono text-[11px] text-ink-500" title={r.found.join(", ")}>now: {r.found.join(", ")}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-hive-50/70 px-4 py-3 text-sm">
            <span>
              Domain ownership: {rep.ownershipVerified ? <b className="text-hive-700">verified</b> : <b className="text-honey-700">waiting for the {"_credoone-verify"} TXT</b>}
            </span>
            <span className="flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-hive-700" />
              Hosting: {rep.vercel.configured ? (rep.vercel.added ? "registered on the Vercel project" : "not registered yet") : `Vercel API not connected — add ${rep.company.customDomain} in Vercel › Settings › Domains`}
            </span>
            {rep.vercel.configured && <span>Ownership: {rep.vercel.verified ? <b className="text-hive-700">verified</b> : <b className="text-honey-700">pending TXT</b>}</span>}
            {rep.vercel.lastCheckedAt && <span className="text-ink-500">Last checked {fmtDate(rep.vercel.lastCheckedAt)}</span>}
            {rep.vercel.lastError && <span className="text-red-600">{rep.vercel.lastError}</span>}
          </div>
        </>
      )}
      <p className="text-sm text-ink-500">
        Step-by-step instructions for the company’s IT team are in{" "}
        <Link href="/sa/knowledgebase" className="font-semibold text-hive-700 underline">
          Knowledgebase › White Label
        </Link>
        . DNS changes usually show up within minutes, occasionally up to 48 hours.
      </p>
    </div>
  );
}

export function DnsModal({ company, onClose, fresh }: { company: { _id: string; name: string } | null; onClose: () => void; fresh?: boolean }) {
  return (
    <Modal open={!!company} onClose={onClose} title={fresh ? `${company?.name} is ready — map its domain` : `Domain & DNS · ${company?.name || ""}`} size="xl" footer={<Btn onClick={onClose}>Done</Btn>}>
      {company && <DnsPanel companyId={company._id} autoCheck={!fresh} />}
    </Modal>
  );
}

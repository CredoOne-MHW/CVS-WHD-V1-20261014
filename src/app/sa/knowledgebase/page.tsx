"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Info, TriangleAlert, Rocket, RefreshCw, Globe2, Server, ShieldCheck, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader, Badge, Btn, Spinner, Empty, useToast } from "@/components/ui";
import { Tabs } from "@/components/Logs";
import { DnsModal } from "@/components/DnsPanel";

function Copyable({ v }: { v: string }) {
  const [ok, setOk] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-hive-50 py-0.5 pl-2 pr-0.5 font-mono text-[12.5px] font-semibold text-hive-900">
      {v}
      <button
        type="button"
        aria-label={`Copy ${v}`}
        className="rounded-md p-1 hover:bg-hive-100"
        onClick={() => {
          navigator.clipboard.writeText(v);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }}
      >
        {ok ? <Check className="h-3.5 w-3.5 text-hive-600" /> : <Copy className="h-3.5 w-3.5 text-ink-500" />}
      </button>
    </span>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      <span className="absolute left-[17px] top-10 h-[calc(100%-40px)] w-px bg-ink-400/20 last:hidden" aria-hidden />
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-hive-600 to-hive-800 text-sm font-bold text-white shadow-glow">{n}</span>
      <div className="min-w-0 flex-1 pt-1.5">
        <h4 className="font-bold text-ink-900">{title}</h4>
        <div className="mt-2 space-y-3 text-[14px] leading-relaxed text-ink-700">{children}</div>
      </div>
    </li>
  );
}

function Callout({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return (
    <div className={`flex gap-3 rounded-2xl border p-3.5 text-[13.5px] ${tone === "warn" ? "border-honey-300 bg-honey-100/60" : "border-hive-200 bg-hive-50/70"}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "warn" ? "text-honey-700" : "text-hive-700"}`} />
      <div>{children}</div>
    </div>
  );
}

function RecordTable({ rows }: { rows: { type: string; host: string; value: string; note?: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-400/15">
      <table className="w-full min-w-[600px]">
        <thead>
          <tr>
            {["Type", "Host / Name", "Value / Points to", "Note"].map((h) => (
              <th key={h} className="th">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="td">
                <span className="rounded-md bg-hive-900 px-2 py-0.5 font-mono text-[11.5px] font-bold text-white">{r.type}</span>
              </td>
              <td className="td">
                <Copyable v={r.host} />
              </td>
              <td className="td">
                <Copyable v={r.value} />
              </td>
              <td className="td text-[13px] text-ink-500">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Knowledgebase() {
  const [tab, setTab] = useState<"white" | "domains">("white");
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => {
    api("/sa/knowledgebase/config").then(setCfg);
  }, []);
  return (
    <>
      <PageHeader title="Knowledgebase" subtitle="How-to guides for running the platform" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "white", label: "White Label" },
          { key: "domains", label: "Company domains" },
        ]}
      />
      {!cfg ? (
        <div className="flex justify-center py-20 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      ) : tab === "white" ? (
        <WhiteLabel cfg={cfg} />
      ) : (
        <Domains />
      )}
    </>
  );
}

function WhiteLabel({ cfg }: { cfg: any }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const base: string = cfg.baseDomain || "mhw.credovation.tech";
  const zone: string = cfg.platform.zone;
  const sub: string = base.slice(0, -(zone.length + 1)) || "@";
  const dep: string = cfg.deploymentHost || "your-project.vercel.app";
  const example = "wellnesshive";

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <article className="space-y-6">
        {/* how it works */}
        <section className="card overflow-hidden">
          <div className="bg-gradient-to-br from-hive-800 to-hive-950 p-6 text-white sm:p-8">
            <p className="eyebrow text-honey-300">White label · overview</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight">Every company gets its own branded login — on our domain or theirs</h2>
            <p className="mt-2 max-w-3xl text-white/75">One deployment serves everyone. The app reads the address in the browser and loads that company’s logo, colours, banner and texts. Nothing is redeployed when you add a company.</p>
          </div>
          <div className="grid gap-4 p-6 sm:grid-cols-3 sm:p-8">
            {[
              { Icon: Server, t: "Super Admin", u: base, d: "CredoOne console — your team only" },
              { Icon: Building2, t: "Company · instant", u: `${example}.${base}`, d: "Live the moment a company is created" },
              { Icon: Globe2, t: "Company · own domain", u: "leads.wellnesshive.in", d: "Optional — after their IT adds 1–2 DNS records" },
            ].map(({ Icon, t, u, d }) => (
              <div key={t} className="rounded-2xl border border-ink-400/15 p-4">
                <Icon className="h-5 w-5 text-hive-700" />
                <p className="mt-2 text-sm font-bold">{t}</p>
                <p className="mt-1 break-all font-mono text-[12.5px] font-semibold text-hive-800">{u}</p>
                <p className="mt-1 text-xs text-ink-500">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Part A */}
        <section className="card p-6 sm:p-8">
          <p className="eyebrow text-hive-700">Part A · once for the platform</p>
          <h3 className="mt-1 text-xl font-extrabold tracking-tight">Point {base} and all its sub-domains at the app</h3>
          <ol className="mt-6">
            <Step n="1" title="Set the environment variables in Vercel">
              <p>
                Vercel → your project (<span className="font-mono text-[13px]">{dep}</span>) → <b>Settings › Environment Variables</b>, then redeploy:
              </p>
              <RecordTable
                rows={[
                  { type: "ENV", host: "APP_BASE_DOMAIN", value: base, note: "Required — the base for <short>.<base>" },
                  { type: "ENV", host: "VERCEL_API_TOKEN", value: "<token>", note: "Optional — Account Settings › Tokens. Lets this app add company domains for you" },
                  { type: "ENV", host: "VERCEL_PROJECT_ID", value: "prj_…", note: "Optional — Project › Settings › General" },
                  { type: "ENV", host: "VERCEL_TEAM_ID", value: "team_…", note: "Only if the project is under a team" },
                ]}
              />
              <p className="text-[13px]">Status here: base domain {cfg.baseDomain ? <Badge color="green">set</Badge> : <Badge color="red">missing</Badge>} · Vercel API {cfg.vercelConfigured ? <Badge color="green">connected</Badge> : <Badge>not connected (manual mode)</Badge>}</p>
            </Step>

            <Step n="2" title={`Add ${base} and *.${base} to the Vercel project`}>
              <p>
                Vercel → project → <b>Settings › Domains › Add</b>: add <Copyable v={base} /> and the wildcard <Copyable v={`*.${base}`} />.
              </p>
              {cfg.vercelConfigured && (
                <Btn
                  variant="secondary"
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await api("/sa/knowledgebase/platform-domains", { method: "POST" });
                      const errs = r.filter((x: any) => x.result?.error);
                      toast(errs.length ? "err" : "ok", errs.length ? errs.map((x: any) => `${x.domain}: ${x.result.error}`).join(" · ") : "Both domains added to Vercel");
                    } catch (e: any) {
                      toast("err", e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Rocket className="h-4 w-4" /> Add both automatically
                </Btn>
              )}
            </Step>

            <Step n="3" title={`Delegate ${base} to Vercel DNS (needed for the wildcard)`}>
              <p>
                Wildcard sub-domains need a wildcard SSL certificate, and Vercel can only issue one when it runs DNS for that name. You don’t have to move all of <b>{zone}</b> — only delegate the <b>{sub}</b> sub-domain. At the DNS provider of <b>{zone}</b>, add:
              </p>
              <RecordTable
                rows={[
                  { type: "NS", host: sub, value: "ns1.vercel-dns.com", note: "Delegates the sub-domain" },
                  { type: "NS", host: sub, value: "ns2.vercel-dns.com", note: "Second nameserver" },
                ]}
              />
              <Callout tone="warn">
                Delete any existing A / CNAME / TXT records for <b>{sub}</b> at {zone}’s provider first — a name can’t have NS records next to other records. Vercel creates the right records inside the delegated zone automatically.
              </Callout>
              <Callout>
                <b>Can’t delegate?</b> Add a single <span className="font-mono">CNAME {sub} → {cfg.fallbackCNAME}</span> for the Super Admin console, then for every company add its sub-domain (<span className="font-mono">{example}.{base}</span>) to Vercel individually and a matching CNAME. It works, it’s just manual per company.
              </Callout>
            </Step>

            <Step n="4" title="Test">
              <p>
                After a few minutes open{" "}
                <a className="font-semibold text-hive-700 underline" href={`https://${base}/login`} target="_blank" rel="noreferrer">
                  https://{base}/login
                </a>{" "}
                — you should see the CredoOne login. Any company sub-domain, e.g. <span className="font-mono">https://{example}.{base}</span>, shows that company’s login. Vercel issues HTTPS certificates automatically.
              </p>
            </Step>
          </ol>
        </section>

        {/* Part B */}
        <section className="card p-6 sm:p-8">
          <p className="eyebrow text-hive-700">Part B · for each company</p>
          <h3 className="mt-1 text-xl font-extrabold tracking-tight">Brand the login and, optionally, map the company’s own domain</h3>
          <ol className="mt-6">
            <Step n="1" title="Create the company and fill Branding & domain">
              <p>
                <Link href="/sa/companies" className="font-semibold text-hive-700 underline">
                  Company › Create
                </Link>{" "}
                → <b>Branding & domain</b> tab: short name (becomes <span className="font-mono">&lt;short&gt;.{base}</span>), logo, side banner, theme and accent colours, login layout, headline, tagline and support contacts. The live preview shows the login before you save.
              </p>
              <p>The theme colour drives the whole company console — sidebar, buttons, charts, badges and the login page. Very light colours are darkened automatically so text stays readable.</p>
            </Step>
            <Step n="2" title="Choose the company’s own address (recommended: a sub-domain)">
              <p>
                Ask the company for a sub-domain such as <Copyable v="leads.wellnesshive.in" /> or <Copyable v="crm.wellnesshive.in" />. A sub-domain doesn’t touch their existing website or email. Enter it in <b>Company’s own domain</b> and save.
              </p>
              <Callout>
                Using a root domain (<span className="font-mono">wellnesshive.in</span>) is possible but replaces whatever website is on it — only do this for a domain bought just for the CRM.
              </Callout>
            </Step>
            <Step n="3" title="Send the DNS records to the company’s IT person">
              <p>
                After saving, the records appear automatically (also via the <Globe2 className="inline h-4 w-4" /> icon on the company row). Typical set for a sub-domain:
              </p>
              <RecordTable
                rows={[
                  { type: "CNAME", host: "leads", value: cfg.fallbackCNAME, note: "Use the exact value shown for that company — with the Vercel API connected it is project-specific" },
                  { type: "TXT", host: "_vercel", value: "vc-domain-verify=leads.wellnesshive.in,…", note: "Only when shown — proves ownership if the domain was used on another Vercel account" },
                ]}
              />
              <p>For a root domain the main record is an <b>A</b> record on host <span className="font-mono">@</span> pointing to the IP shown (Vercel’s default is {cfg.fallbackA}).</p>
            </Step>
            <Step n="4" title="Where to click at common DNS providers">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <b>GoDaddy:</b> My Products › Domain › DNS › Add New Record. Type CNAME, Name <span className="font-mono">leads</span>, Value as shown, TTL 1 hour.
                </li>
                <li>
                  <b>Hostinger:</b> Domains › DNS / Nameservers › Manage DNS records. Name <span className="font-mono">leads</span>, Target as shown.
                </li>
                <li>
                  <b>Cloudflare:</b> DNS › Records › Add record. <b>Set Proxy status to “DNS only” (grey cloud)</b>, otherwise SSL can’t be issued.
                </li>
                <li>
                  <b>BigRock / Namecheap / Route 53:</b> same fields — enter only the host part (<span className="font-mono">leads</span>), never the full domain twice.
                </li>
              </ul>
            </Step>
            <Step n="5" title="Verify and go live">
              <p>
                Open the company’s DNS panel and press <b>Check DNS now</b>. Each record turns green once it’s visible worldwide; with the Vercel API connected the app also registers the domain and triggers verification. HTTPS is issued automatically within minutes — no certificate to buy or upload.
              </p>
              <p>Then share the URL with the company admin. Logins are isolated: on a company’s address only that company’s users can sign in.</p>
            </Step>
          </ol>
        </section>

        {/* Troubleshooting */}
        <section className="card p-6 sm:p-8">
          <h3 className="text-lg font-extrabold tracking-tight">Troubleshooting</h3>
          <dl className="mt-4 divide-y divide-ink-400/10">
            {[
              ["Record shows “Not found yet”", "DNS usually updates in 5–30 minutes; some providers take up to 48 h. Check the host field contains only the sub-domain part (leads, not leads.wellnesshive.in)."],
              ["Record shows “Different value”", "Another A/CNAME already exists for that name. Delete it, keep only the record shown here."],
              ["Browser says the connection isn’t private", "SSL is still being issued, or Cloudflare proxy is on. Switch to DNS only and wait a few minutes."],
              ["“No workspace here yet” page", "The address isn’t saved on any company. Check the short name / domain spelling in Branding & domain."],
              ["Domain already used by another Vercel account", "Add the _vercel TXT record shown in the company’s DNS panel, then Check DNS now."],
              ["Company has CAA records", 'Add CAA 0 issue "letsencrypt.org" so the free certificate can be issued.'],
            ].map(([q, a]) => (
              <div key={q} className="grid gap-1 py-3.5 sm:grid-cols-[260px_1fr] sm:gap-6">
                <dt className="text-sm font-bold">{q}</dt>
                <dd className="text-sm text-ink-700">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </article>

      <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
        <div className="card p-5">
          <p className="eyebrow text-ink-500">This platform</p>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-ink-500">Base domain</dt>
              <dd className="mt-0.5 break-all font-mono font-semibold">{base}</dd>
            </div>
            <div>
              <dt className="text-ink-500">DNS zone</dt>
              <dd className="mt-0.5 font-mono font-semibold">{zone}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Deployment</dt>
              <dd className="mt-0.5 break-all font-mono font-semibold">{dep}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Company URL pattern</dt>
              <dd className="mt-0.5 break-all font-mono font-semibold">&lt;short&gt;.{base}</dd>
            </div>
          </dl>
        </div>
        <div className="card p-5">
          <ShieldCheck className="h-5 w-5 text-hive-700" />
          <p className="mt-2 text-sm font-bold">Security by design</p>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink-700">
            <li>• Sessions are bound to the exact address — a login on one company’s domain never works on another.</li>
            <li>• Super Admin can only sign in on {base}.</li>
            <li>• Logos and banners are served through the app; the S3 bucket stays private.</li>
          </ul>
        </div>
        <a href="https://vercel.com/docs/domains/set-up-custom-domain" target="_blank" rel="noreferrer" className="card flex items-center justify-between gap-3 p-5 text-sm font-semibold text-hive-800 hover:bg-hive-50">
          Vercel: custom domain docs <ExternalLink className="h-4 w-4" />
        </a>
      </aside>
    </div>
  );
}

function Domains() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [live, setLive] = useState(false);
  const [dns, setDns] = useState<any>(null);
  const load = (l: boolean) => {
    setRows(null);
    api(`/sa/knowledgebase/domains${l ? "?live=1" : ""}`).then(setRows);
  };
  useEffect(() => load(false), []);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-400/15 p-4">
        <p className="text-sm text-ink-500">Every company’s addresses and white-label status.</p>
        <Btn
          variant="secondary"
          onClick={() => {
            setLive(true);
            load(true);
          }}
        >
          <RefreshCw className="h-4 w-4" /> Check all DNS live
        </Btn>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              {["Company", "Platform URL", "Own domain", "Status", ""].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r._id}>
                <td className="td">
                  <div className="flex items-center gap-2.5">
                    <span className="h-3 w-3 rounded-full" style={{ background: r.themeColor || "#2f5c24" }} aria-hidden />
                    <span className="font-semibold">{r.name}</span>
                    {r.status !== "active" && <Badge color="red">inactive</Badge>}
                  </div>
                </td>
                <td className="td">
                  {r.platformUrl ? (
                    <a className="font-mono text-[12.5px] text-hive-700 hover:underline" href={r.platformUrl} target="_blank" rel="noreferrer">
                      {r.platformUrl.replace("https://", "")}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="td font-mono text-[12.5px]">{r.customDomain || <span className="font-sans text-ink-400">—</span>}</td>
                <td className="td">
                  {!r.customDomain ? <Badge>Sub-domain only</Badge> : live ? r.ready ? <Badge color="green">Live</Badge> : <Badge color="honey">Waiting for DNS</Badge> : r.verified === false ? <Badge color="honey">Ownership pending</Badge> : <Badge color="blue">Not checked</Badge>}
                  {r.lastError && <p className="mt-1 max-w-[220px] truncate text-xs text-red-600" title={r.lastError}>{r.lastError}</p>}
                </td>
                <td className="td text-right">
                  <button className="btn-ghost" onClick={() => setDns({ _id: r._id, name: r.name })}>
                    <Globe2 className="h-4 w-4" /> DNS
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows && (
          <div className="flex justify-center py-14 text-hive-700">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {rows && !rows.length && <Empty title="No companies yet" />}
      </div>
      <DnsModal company={dns} onClose={() => setDns(null)} />
    </div>
  );
}

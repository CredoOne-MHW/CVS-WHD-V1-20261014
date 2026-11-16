"use client";
/**
 * DPDP consent — the same screen for a company (Settings › DPDP) and for Super Admin on a company's
 * workspace. `base` is whose notice is being worked on: "/co" for the signed-in company, or
 * "/sa/companies/<id>" for one company from Super Admin, or "/sa" for the platform's default notice.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, Upload, Save, Eye, Link2, Copy, Download, FileDown, RotateCcw, Check, X, Clock, MousePointerClick, Cookie, Search, AlertTriangle, History } from "lucide-react";
import { api, qs, fmtDate, download } from "@/lib/api";
import { Field, Btn, Badge, Spinner, Empty, Pager, Modal, Stat, Confirm, useToast } from "@/components/ui";
import { Tabs } from "@/components/Logs";

const secs = (n?: number) => (n == null ? "—" : n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`);

export function Dpdp({ base, canEdit = true, platform = false }: { base: string; canEdit?: boolean; platform?: boolean }) {
  const [tab, setTab] = useState<"notice" | "acceptance" | "cookies">("notice");
  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={platform ? [{ key: "notice" as const, label: "Consent notice" }] : [
          { key: "notice" as const, label: "Consent notice" },
          { key: "acceptance" as const, label: "Acceptance status" },
          { key: "cookies" as const, label: "Cookie consent" },
        ]}
      />
      {tab === "notice" && <NoticeTab base={base} canEdit={canEdit} platform={platform} />}
      {tab === "acceptance" && <AcceptanceTab base={base} canEdit={canEdit} />}
      {tab === "cookies" && <CookiesTab base={base} />}
    </div>
  );
}

/* ───────────────────────── The notice ───────────────────────── */

function NoticeTab({ base, canEdit, platform }: { base: string; canEdit: boolean; platform: boolean }) {
  const [d, setD] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [md, setMd] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [officer, setOfficer] = useState({ dpdpOfficer: "", dpdpOfficerEmail: "" });
  const [useDefault, setUseDefault] = useState(false);
  const toast = useToast();

  const load = useCallback(
    () =>
      api(`${base}/dpdp`).then((r) => {
        setD(r);
        setTitle(r.editor?.title || r.notice?.title || "");
        setMd(r.editor?.markdown || r.notice?.markdown || "");
        setOfficer({ dpdpOfficer: r.company?.officer || "", dpdpOfficerEmail: r.company?.officerEmail || "" });
        setDirty(false);
      }),
    [base]
  );
  useEffect(() => {
    load();
  }, [load]);

  if (!d)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const notice = d.notice;
  const consentUrl = d.consentUrl;

  async function publish() {
    setBusy("publish");
    try {
      const r = await api(`${base}/dpdp`, { body: { title, markdown: md } });
      toast("ok", `Published as v${r.version}`);
      await load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }
  async function upload(file?: File | null) {
    if (!file) return;
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title || file.name.replace(/\.[^.]+$/, ""));
      const r = await api(`${base}/dpdp/upload`, { form: fd });
      toast("ok", `Uploaded and published as v${r.version}`);
      await load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3 rounded-2xl bg-hive-50/70 p-4 text-sm text-ink-700">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
        <p className="min-w-0 flex-1">
          {platform ? (
            <>This is the platform’s notice. Every company starts from it, with its own name, address and grievance officer filled in, until it writes or uploads one of its own.</>
          ) : (
            <>
              The notice shown before any personal data is collected. It opens at the link below from the website, the apps and the CRM: the person must scroll it to the end before <b>Accept</b> turns on, and there is no way past it other than accepting or closing the window.
              {d.usingDefault && <> You are using the platform’s notice with your details filled in — edit it below to make it your own.</>}
            </>
          )}
        </p>
      </div>

      {!platform && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-ink-400/15 bg-white p-4">
            <p className="label">Consent link</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-400/5 px-3 py-2 font-mono text-xs">{consentUrl}</code>
              <Btn type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(consentUrl).then(() => toast("ok", "Copied"))}>
                <Copy className="h-4 w-4" /> Copy
              </Btn>
              <a className="btn-secondary inline-flex items-center gap-2" href={consentUrl} target="_blank" rel="noreferrer">
                <Eye className="h-4 w-4" /> Open
              </a>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Add <span className="mono">?from=app</span> or <span className="mono">?from=crm</span> to record where it was opened from, and <span className="mono">?next=/path</span> to send the person on once they accept.
            </p>
          </div>
          <div className="rounded-2xl border border-ink-400/15 bg-white p-4">
            <p className="label">Live version</p>
            <p className="mt-1 text-sm">
              <b>v{notice.version}</b> · {notice.source === "upload" ? "uploaded file" : "written here"} · {fmtDate(notice.updatedAt, false)}
            </p>
            {notice.usingDefault && <Badge color="honey">platform default</Badge>}
            {notice.hasFile && (
              <a className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-hive-700 hover:underline" href={`${base === "/co" ? "/api/co" : `/api${base}`}/dpdp/file`}>
                <FileDown className="h-3.5 w-3.5" /> {notice.fileName}
              </a>
            )}
          </div>
        </div>
      )}

      {notice.missing?.length > 0 && (
        <p className="flex items-start gap-2 rounded-2xl border border-honey-500/40 bg-honey-500/10 px-4 py-3 text-sm text-ink-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-honey-700" />
          <span>
            Still to fill in: <b>{notice.missing.join(", ")}</b>. Set them on Company details and the grievance officer below — until then the placeholder is shown as it is.
          </span>
        </p>
      )}

      {!platform && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grievance officer" hint="Named in the notice as the person to write to">
            <input className="input" value={officer.dpdpOfficer} onChange={(e) => setOfficer({ ...officer, dpdpOfficer: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label="Grievance officer e-mail">
            <div className="flex gap-2">
              <input className="input" type="email" value={officer.dpdpOfficerEmail} onChange={(e) => setOfficer({ ...officer, dpdpOfficerEmail: e.target.value })} disabled={!canEdit} />
              <Btn
                type="button"
                variant="secondary"
                loading={busy === "officer"}
                disabled={!canEdit}
                onClick={async () => {
                  setBusy("officer");
                  try {
                    await api(`${base}/dpdp/officer`, { method: "PUT", body: officer });
                    toast("ok", "Saved");
                    await load();
                  } catch (e: any) {
                    toast("err", e.message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Save className="h-4 w-4" />
              </Btn>
            </div>
          </Field>
        </div>
      )}

      <section className="rounded-2xl border border-ink-400/15 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-400/15 p-4">
          <h3 className="font-bold">Write the notice</h3>
          <div className="flex flex-wrap gap-2">
            <Btn type="button" variant="secondary" onClick={() => setPreview(md)}>
              <Eye className="h-4 w-4" /> Preview
            </Btn>
            {!platform && (
              <label className={`btn-secondary inline-flex items-center gap-2 ${canEdit ? "cursor-pointer" : "pointer-events-none opacity-50"}`}>
                <Upload className="h-4 w-4" /> {busy === "upload" ? "Uploading…" : "Upload PDF / Word"}
                <input type="file" accept=".pdf,.docx,.md,.txt" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
              </label>
            )}
            {!platform && !d.usingDefault && (
              <Btn type="button" variant="ghost" onClick={() => setUseDefault(true)} disabled={!canEdit}>
                <RotateCcw className="h-4 w-4" /> Use the platform’s
              </Btn>
            )}
            <Btn type="button" onClick={publish} loading={busy === "publish"} disabled={!canEdit || !dirty || md.trim().length < 50}>
              <Save className="h-4 w-4" /> Publish
            </Btn>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <Field label="Title">
            <input
              className="input"
              value={title}
              disabled={!canEdit}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Notice" hint="Markdown. Placeholders like {{company.name}} are filled in when the notice is shown.">
            <textarea
              className="input min-h-[420px] font-mono text-[13px] leading-relaxed"
              value={md}
              disabled={!canEdit}
              onChange={(e) => {
                setMd(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <p className="text-xs text-ink-500">
            {md.trim().split(/\s+/).filter(Boolean).length.toLocaleString("en-IN")} words. Publishing creates a new version; earlier versions are kept so an acceptance always points at the text that was accepted.
          </p>
        </div>
      </section>

      {d.versions?.length > 1 && (
        <section className="rounded-2xl border border-ink-400/15 bg-white">
          <h3 className="flex items-center gap-2 border-b border-ink-400/15 p-4 font-bold">
            <History className="h-4 w-4 text-hive-700" /> Versions
          </h3>
          <table className="w-full">
            <tbody>
              {d.versions.map((v: any) => (
                <tr key={v._id} className="border-b border-ink-400/10 last:border-0">
                  <td className="td font-semibold">
                    v{v.version} {v.active && <Badge color="green">live</Badge>}
                  </td>
                  <td className="td text-ink-600">{v.title}</td>
                  <td className="td text-xs text-ink-500">{v.source === "upload" ? "uploaded" : "written"}</td>
                  <td className="td whitespace-nowrap text-xs text-ink-500">
                    {fmtDate(v.publishedAt, false)} · {v.publishedBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Preview" size="lg" footer={<Btn variant="secondary" onClick={() => setPreview(null)}>Close</Btn>}>
        <PreviewBody base={base} markdown={preview || ""} />
      </Modal>

      <Confirm
        open={useDefault}
        title="Use the platform’s notice?"
        body="Your own versions are kept and can be published again at any time. New visitors will see the platform's notice with your details filled in."
        confirmLabel="Use the platform’s"
        onClose={() => setUseDefault(false)}
        onConfirm={async () => {
          try {
            await api(`${base}/dpdp/use-default`, { method: "POST" });
            toast("ok", "Now using the platform’s notice");
            await load();
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </div>
  );
}

/** The written notice as the person will see it — rendered by the server, so it matches exactly. */
function PreviewBody({ base, markdown }: { base: string; markdown: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api(`${base}/dpdp/preview`, { body: { markdown } })
      .then((r) => live && setHtml(r.html))
      .catch(() => live && setHtml(`<p>${markdown.replace(/[<>&]/g, "")}</p>`));
    return () => {
      live = false;
    };
  }, [base, markdown]);
  if (html === null)
    return (
      <div className="flex justify-center py-10 text-hive-700">
        <Spinner className="h-5 w-5" />
      </div>
    );
  return <div className="kb-doc max-h-[60vh] overflow-y-auto" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ───────────────────────── Acceptance status ───────────────────────── */

function AcceptanceTab({ base, canEdit }: { base: string; canEdit: boolean }) {
  const [f, setF] = useState({ q: "", status: "", source: "", from: "", to: "", page: 1 });
  const [data, setData] = useState<any>(null);
  const [sum, setSum] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const [drop, setDrop] = useState<any>(null);
  const toast = useToast();

  const load = useCallback(() => {
    setData(null);
    api(`${base}/dpdp/consents${qs(f)}`).then(setData);
    api(`${base}/dpdp/summary`).then(setSum).catch(() => {});
  }, [base, f]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      {sum && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Accepted" value={sum.accepted} hint={`${sum.last7} in the last 7 days`} />
          <Stat label="Read to the end" value={`${sum.total ? Math.round((sum.readToEnd / sum.total) * 100) : 0}%`} hint={`${sum.readToEnd} of ${sum.total}`} tone="honey" />
          <Stat label="Average time on the notice" value={secs(sum.avgSeconds)} hint="before accepting" />
          <Stat label="Withdrawn" value={sum.withdrawn} hint={sum.withdrawn ? "consent taken back" : "none"} tone={sum.withdrawn ? "red" : "gray"} />
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input w-60 pl-9" placeholder="Name, e-mail, phone" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
          </div>
          <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} aria-label="Status">
            <option value="">All</option>
            <option value="accepted">Accepted</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
          <select className="input w-auto" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value, page: 1 })} aria-label="Source">
            <option value="">Every source</option>
            {["website", "app", "crm", "form"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input className="input w-auto" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} aria-label="From" />
          <input className="input w-auto" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} aria-label="To" />
          <Btn type="button" variant="secondary" className="ml-auto" onClick={() => download(`${base}/dpdp/report`, { kind: "consents" }, "dpdp-acceptance.xlsx").catch((e: any) => toast("err", e.message))}>
            <Download className="h-4 w-4" /> Download
          </Btn>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr>
                {["Who", "Accepted", "Read", "Purposes", "Source", "Status", ""].map((h) => (
                  <th key={h} className="th">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((x: any) => (
                <tr key={x._id} className="hover:bg-hive-50/40">
                  <td className="td">
                    <p className="font-semibold">{x.name || x.email || x.phone || "Visitor"}</p>
                    <p className="text-xs text-ink-500">{[x.email, x.phone].filter(Boolean).join(" · ") || <span className="mono">{x.visitorId}</span>}</p>
                  </td>
                  <td className="td whitespace-nowrap text-sm">{fmtDate(x.acceptedAt)}</td>
                  <td className="td whitespace-nowrap text-sm">
                    <span className="inline-flex items-center gap-1 text-ink-600">
                      <Clock className="h-3.5 w-3.5 text-ink-400" /> {secs(x.readSeconds)}
                    </span>
                    <span className="ml-3 inline-flex items-center gap-1 text-ink-600">
                      <MousePointerClick className="h-3.5 w-3.5 text-ink-400" /> {x.scrollPct ?? 0}%
                    </span>
                  </td>
                  <td className="td text-xs text-ink-600">{(x.purposes || []).length} of 5</td>
                  <td className="td text-xs capitalize text-ink-500">{x.source}</td>
                  <td className="td">
                    <Badge color={x.withdrawnAt ? "red" : "green"}>{x.withdrawnAt ? "Withdrawn" : "Accepted"}</Badge>
                  </td>
                  <td className="td text-right">
                    <button className="btn-ghost" title="Details" aria-label="Details" onClick={() => setView(x)}>
                      <Eye className="h-4 w-4" />
                    </button>
                    {canEdit && !x.withdrawnAt && (
                      <button className="btn-ghost text-red-600 hover:bg-red-50" title="Record a withdrawal" aria-label="Withdraw" onClick={() => setDrop(x)}>
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && (
            <div className="flex justify-center py-16 text-hive-700">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {data && !data.items.length && <Empty title="No consents yet" hint="They appear as soon as someone accepts the notice." />}
        </div>
        {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </div>

      <Modal open={!!view} onClose={() => setView(null)} title="Consent record" size="md" footer={<Btn variant="secondary" onClick={() => setView(null)}>Close</Btn>}>
        {view && (
          <dl className="divide-y divide-ink-400/10 text-sm">
            {[
              ["Accepted on", fmtDate(view.acceptedAt)],
              ["Name", view.name || "—"],
              ["E-mail", view.email || "—"],
              ["Phone", view.phone || "—"],
              ["Who", view.subjectKind],
              ["Visitor id", view.visitorId || "—"],
              ["Notice version", `v${view.documentVersion}`],
              ["Opened", fmtDate(view.openedAt)],
              ["Time on the notice", secs(view.readSeconds)],
              ["Scrolled", `${view.scrollPct ?? 0}%`],
              ["Reached the end", view.reachedEndAt ? fmtDate(view.reachedEndAt) : "no"],
              ["Purposes", (view.purposes || []).join(", ") || "—"],
              ["Opened from", view.page || view.source],
              ["IP", view.ip || "—"],
              ["Device", view.userAgent || "—"],
              ...(view.withdrawnAt ? [["Withdrawn on", `${fmtDate(view.withdrawnAt)} by ${view.withdrawnBy}`]] : []),
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-start justify-between gap-4 py-2">
                <dt className="shrink-0 text-ink-500">{k}</dt>
                <dd className="break-all text-right font-medium">{v as any}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>

      <Confirm
        open={!!drop}
        danger
        title="Record a withdrawal?"
        body={`${drop?.name || drop?.email || drop?.phone || "This person"} asked to withdraw their consent. The record is kept and marked withdrawn — the Act requires the record itself to survive.`}
        confirmLabel="Record it"
        onClose={() => setDrop(null)}
        onConfirm={async () => {
          try {
            await api(`${base}/dpdp/consents/${drop._id}/withdraw`, { method: "POST" });
            toast("ok", "Withdrawal recorded");
            load();
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </div>
  );
}

/* ───────────────────────── Cookie consent ───────────────────────── */

function CookiesTab({ base }: { base: string }) {
  const [f, setF] = useState({ choice: "", page: 1 });
  const [data, setData] = useState<any>(null);
  const [sum, setSum] = useState<any>(null);
  const toast = useToast();

  useEffect(() => {
    setData(null);
    api(`${base}/dpdp/cookies${qs(f)}`).then(setData);
    api(`${base}/dpdp/summary`).then(setSum).catch(() => {});
  }, [base, f]);

  return (
    <div className="space-y-4">
      {sum?.cookies && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Choices recorded" value={sum.cookies.total} hint="one per browser, per change" />
          <Stat label="Accepted all" value={sum.cookies.all} hint={sum.cookies.total ? `${Math.round((sum.cookies.all / sum.cookies.total) * 100)}%` : "—"} tone="honey" />
          <Stat label="Necessary only" value={sum.cookies.necessary} hint="analytics and marketing refused" />
          <Stat label="Chose their own" value={sum.cookies.custom} hint="some groups on, some off" tone="gray" />
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
          <Cookie className="h-4 w-4 text-hive-700" />
          <p className="text-sm text-ink-600">What each visitor chose in the cookie banner, as the Act and the IT Rules require.</p>
          <select className="input ml-auto w-auto" value={f.choice} onChange={(e) => setF({ choice: e.target.value, page: 1 })} aria-label="Choice">
            <option value="">All choices</option>
            <option value="all">Accepted all</option>
            <option value="necessary">Necessary only</option>
            <option value="custom">Their own</option>
          </select>
          <Btn type="button" variant="secondary" onClick={() => download(`${base}/dpdp/report`, { kind: "cookies" }, "cookie-consent.xlsx").catch((e: any) => toast("err", e.message))}>
            <Download className="h-4 w-4" /> Download
          </Btn>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                {["Visitor", "Decided", "Choice", "Preferences", "Analytics", "Marketing", "Page"].map((h) => (
                  <th key={h} className="th">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((x: any) => (
                <tr key={x._id} className="hover:bg-hive-50/40">
                  <td className="td mono text-xs">{x.visitorId}</td>
                  <td className="td whitespace-nowrap text-sm">{fmtDate(x.decidedAt)}</td>
                  <td className="td">
                    <Badge color={x.choice === "all" ? "green" : x.choice === "necessary" ? "gray" : "honey"}>{x.choice === "all" ? "All" : x.choice === "necessary" ? "Necessary" : "Their own"}</Badge>
                  </td>
                  {(["preferences", "analytics", "marketing"] as const).map((k) => (
                    <td key={k} className="td text-center">
                      {x.categories?.[k] ? <Check className="mx-auto h-4 w-4 text-hive-700" /> : <X className="mx-auto h-4 w-4 text-ink-400" />}
                    </td>
                  ))}
                  <td className="td max-w-[220px] truncate text-xs text-ink-500">{x.page || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && (
            <div className="flex justify-center py-16 text-hive-700">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {data && !data.items.length && <Empty title="No cookie choices yet" hint="They appear once the banner is shown on the website." />}
        </div>
        {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </div>
    </div>
  );
}

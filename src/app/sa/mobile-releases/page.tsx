"use client";
/**
 * Super Admin › Mobile App Release — every company's app in one place.
 *
 * Three things live here: what is happening right now across all companies, the one GitHub setting that makes
 * a push to the app's code rebuild everybody's app, and starting a build for one company or for all of them.
 *
 * The per-company Mobile App tab still decides what an app is called and how it looks — this screen never
 * changes that, it only builds.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Smartphone, Hammer, GitBranch, Copy, Eye, RefreshCw, ShieldCheck, CheckCircle2, XCircle, Clock, ExternalLink, AlertTriangle, Loader2, UploadCloud } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { PageHeader, Btn, Badge, Spinner, Empty, Field, useToast } from "@/components/ui";
import { BUILD_LABEL, platformLabel, targetHint, type BuildStatus } from "@shared/mobile";

const TONE: Record<BuildStatus, "green" | "honey" | "red" | "gray"> = { ready: "green", building: "honey", queued: "gray", failed: "red", cancelled: "gray" };
const PAGE = 25;

export default function Page() {
  const toast = useToast();
  const [sum, setSum] = useState<any>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [busy, setBusy] = useState("");

  const loadSummary = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api<any>("/sa/mobile-releases/summary", { fresh: true }), api<any>("/sa/mobile-releases/companies", { fresh: true })]);
      setSum(s);
      setCompanies(c.companies || []);
      setFailed(null);
    } catch (e: any) {
      setFailed(e?.message || "The platform did not answer.");
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (failed)
    return (
      <>
        <PageHeader title="Mobile App Release" subtitle="Every company's phone app — start a build, follow it, and see which versions are in use." />
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/60 p-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="font-bold">This page could not be loaded.</p>
            <p className="mono mt-1 text-xs text-ink-500">{failed}</p>
            <Btn variant="secondary" className="mt-4" onClick={loadSummary}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Btn>
          </div>
        </div>
      </>
    );

  if (!sum)
    return (
      <>
        <PageHeader title="Mobile App Release" subtitle="Every company's phone app — start a build, follow it, and see which versions are in use." />
        <div className="flex justify-center py-16 text-hive-700">
          <Spinner className="h-6 w-6" />
        </div>
      </>
    );

  return (
    <>
      <PageHeader
        title="Mobile App Release"
        subtitle="Every company's phone app — start a build, follow it, and see which versions are in use."
        actions={
          <Btn variant="secondary" onClick={loadSummary} loading={busy === "refresh"}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
        }
      />

      <Stats s={sum.stats} />
      {!sum.setup.ok && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-honey-500/40 bg-honey-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-honey-700" />
          <p>
            Builds are not set up yet — missing <b>{(sum.setup.missing || []).join(", ")}</b>. Add them to the platform's environment; <b>Knowledge Base › GitHub build</b> explains each one.
          </p>
        </div>
      )}

      <AutoBuild sum={sum} onChanged={loadSummary} toast={toast} />
      <StartBuild sum={sum} companies={companies} onStarted={loadSummary} toast={toast} busy={busy} setBusy={setBusy} />
      <Builds companies={companies} />
    </>
  );
}

/* ───────────────────────── The four numbers ───────────────────────── */

function Stats({ s }: { s: any }) {
  const cards = [
    { label: "Building now", value: s.building, hint: "On GitHub Actions", Icon: Hammer, tone: "text-hive-700" },
    { label: "Ready · 7 days", value: s.ready, hint: "Finished and downloadable", Icon: CheckCircle2, tone: "text-emerald-600" },
    { label: "Failed · 7 days", value: s.failed, hint: "Open the row for the reason", Icon: XCircle, tone: "text-red-600" },
    {
      label: "Devices on newest version",
      value: `${s.devices.current} / ${s.devices.total}`,
      hint: `${Math.max(0, s.devices.total - s.devices.current)} on an older version · last 30 days`,
      Icon: Smartphone,
      tone: "text-ink-600",
    },
  ];
  return (
    <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="card p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{c.label}</p>
            <c.Icon className={`h-5 w-5 shrink-0 ${c.tone}`} />
          </div>
          <p className="mt-3 text-3xl font-black">{c.value}</p>
          <p className="mt-1 text-xs text-ink-500">{c.hint}</p>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Automatic rebuilds (the GitHub set-up) ───────────────────────── */

function AutoBuild({ sum, onChanged, toast }: { sum: any; onChanged: () => void; toast: ReturnType<typeof useToast> }) {
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState(sum.auto.branch || "main");
  const [secret, setSecret] = useState<string | null>(null);
  const [callbackSecret, setCallbackSecret] = useState<string | null>(null);
  const [pushed, setPushed] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const webhook = `${sum.platformUrl || ""}${sum.webhookPath}`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("ok", `${what} copied`);
    } catch {
      toast("err", "Your browser would not let the page copy — select it by hand");
    }
  };

  const save = async (patch: any, label: string) => {
    setBusy(label);
    try {
      await api("/sa/mobile-releases/auto", { method: "PUT", body: patch });
      if (patch.rotate) setSecret(null);
      toast("ok", "Saved");
      onChanged();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="card mb-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
          <div className="min-w-0">
            <h3 className="font-bold">Automatic rebuilds on new code</h3>
            <p className="text-sm text-ink-600">
              Every push to <span className="mono">{sum.auto.branch}</span> on GitHub rebuilds the app of every company with <b>Auto build</b> on, each with its own name, icon and colours. Phones get it as an update.
            </p>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2">
          <input type="checkbox" className="h-5 w-9 cursor-pointer accent-hive-700" checked={!!sum.auto.on} onChange={(e) => save({ on: e.target.checked }, "on")} />
          <span className="text-sm font-bold">{sum.auto.on ? "On" : "Off"}</span>
        </label>
      </div>

      {sum.auto.lastPush && (
        <p className="mt-3 rounded-xl bg-ink-400/[0.05] px-3 py-2 text-sm text-ink-700">
          Last push: <span className="mono">{sum.auto.lastPush.sha}</span> “{sum.auto.lastPush.message}” · {fmtDate(sum.auto.lastPush.at, false)} ·{" "}
          <b>
            {sum.auto.lastPush.builds} build{sum.auto.lastPush.builds === 1 ? "" : "s"} for {sum.auto.lastPush.companies} compan{sum.auto.lastPush.companies === 1 ? "y" : "ies"}
          </b>
        </p>
      )}

      <button type="button" className="mt-3 text-sm font-bold text-hive-700 hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Set up in GitHub (once)
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-xl border border-ink-400/15 p-4">
          <p className="text-sm text-ink-700">
            The repository already has <span className="mono">.github/workflows/build-mobile.yml</span>. It needs these three values as repository secrets — press <b>Set up secrets in GitHub</b> below to have them written for you, or copy each one into GitHub → Settings → Secrets and variables → Actions:
          </p>

          <Row label="PLATFORM_URL" value={sum.platformUrl || "— APP_BASE_URL is not set —"} onCopy={() => copy(sum.platformUrl, "Address")} />

          <div className="flex flex-wrap items-center gap-2">
            <span className="mono w-44 shrink-0 text-[13px]">BUILD_TRIGGER_SECRET</span>
            <span className="mono min-w-0 flex-1 truncate rounded-lg bg-ink-400/[0.06] px-3 py-2 text-[13px]">{secret ?? (sum.auto.hasSecret ? "••••••••••••••••••••••" : "— not made yet —")}</span>
            <Btn
              variant="secondary"
              loading={busy === "show"}
              onClick={async () => {
                setBusy("show");
                try {
                  const r = await api<any>("/sa/mobile-releases/auto/secret", { fresh: true });
                  setSecret(r.secret || "— not made yet —");
                  setCallbackSecret(r.buildSecret || "— not made yet —");
                } finally {
                  setBusy("");
                }
              }}
            >
              <Eye className="h-4 w-4" /> Show
            </Btn>
            <Btn variant="secondary" onClick={() => copy(secret || "", "Secret")} disabled={!secret}>
              <Copy className="h-4 w-4" /> Copy
            </Btn>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mono w-44 shrink-0 text-[13px]">MOBILE_BUILD_SECRET</span>
            <span className="mono min-w-0 flex-1 truncate rounded-lg bg-ink-400/[0.06] px-3 py-2 text-[13px]">
              {callbackSecret ?? (sum.setup.buildSecret?.present ? "••••••••••••••••••••••" : "— not made yet —")}
            </span>
            <Btn variant="secondary" onClick={() => copy(callbackSecret || "", "Secret")} disabled={!callbackSecret}>
              <Copy className="h-4 w-4" /> Copy
            </Btn>
          </div>
          <p className="text-xs text-ink-500">
            {sum.setup.buildSecret?.source === "env"
              ? "This one comes from MOBILE_BUILD_SECRET in the platform's environment. Change it there."
              : "The platform makes and keeps this one — there is nothing to set in the environment. It signs what a finished build reports back, and proves a build may collect a signing key, so the same value must also be a secret in the repository."}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-44 shrink-0 text-sm font-semibold">Branch</span>
            <input className="input mono max-w-[14rem]" value={branch} onChange={(e) => setBranch(e.target.value)} />
            <Btn variant="secondary" loading={busy === "branch"} disabled={branch === sum.auto.branch} onClick={() => save({ branch }, "branch")}>
              Save
            </Btn>
            <Btn variant="ghost" loading={busy === "rotate"} onClick={() => save({ rotate: true }, "rotate")}>
              <RefreshCw className="h-4 w-4" /> New secret
            </Btn>
          </div>
          <p className="text-xs text-ink-500">A new secret stops the old one working the moment it is saved — paste it into GitHub straight away.</p>

          <div className="rounded-xl bg-hive-50/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-sm text-ink-700">
                Or let the platform write both of them into <span className="mono">{sum.setup.repo || "the repository"}</span> for you — nothing to paste.
              </p>
              <Btn
                variant="secondary"
                loading={busy === "push"}
                onClick={async () => {
                  setBusy("push");
                  setPushed(null);
                  try {
                    setPushed(await api<any>("/sa/mobile-releases/github-secrets", { method: "POST" }));
                  } catch (e: any) {
                    setPushed({ results: [{ name: "all", ok: false, message: e?.message }] });
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <UploadCloud className="h-4 w-4" /> Set up secrets in GitHub
              </Btn>
            </div>
            {pushed && (
              <ul className="mt-2 space-y-1">
                {(pushed.results || []).map((r2: any) => (
                  <li key={r2.name} className={`flex items-start gap-2 text-xs ${r2.ok ? "text-hive-800" : "text-honey-800"}`}>
                    {r2.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <span>
                      <span className="mono">{r2.name}</span> — {r2.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink-500">This needs the build token to carry <b>Secrets: read and write</b>. Where it does not, the values above still work by hand.</p>
          </div>

          <p className="text-sm text-ink-700">
            Or use a repository webhook instead: Payload URL <span className="mono">{webhook}</span>, content type <span className="mono">JSON</span>, the same secret, “Just the push event”.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-400/15 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
          <div>
            <p className="font-bold">Build set-up</p>
            <p className="text-xs text-ink-500">
              Repository <span className="mono">{sum.setup.repo || "— not set —"}</span> · workflow <span className="mono">{sum.setup.workflow}</span> · signing key{" "}
              {sum.setup.signingEnabled ? "kept by the platform" : "from the repository's secrets"} · iOS {sum.setup.ios ? "on" : "off"}
            </p>
          </div>
        </div>
        <Btn variant="secondary" onClick={onChanged}>
          <ShieldCheck className="h-4 w-4" /> Check GitHub setup
        </Btn>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
        {(sum.setup.requirements || []).map((r: any) => (
          <div key={r.key} className="flex items-start gap-2 text-sm">
            {r.problem ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-honey-600" />
            ) : r.set === true ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-hive-700" />
            ) : r.set === false ? (
              <XCircle className={`mt-0.5 h-4 w-4 shrink-0 ${r.required ? "text-red-600" : "text-ink-300"}`} />
            ) : (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" />
            )}
            <span className="min-w-0">
              <span className="mono text-[12px]">{r.key}</span>
              {r.problem ? (
                <span className="block text-xs font-semibold text-honey-800">{r.problem}</span>
              ) : (
                <span className="block text-xs text-ink-500">
                {r.heldByPlatform
                  ? "Kept by the platform — nothing to set here. Use “Set up secrets in GitHub”, or copy it from the panel above, so the repository has the same value."
                  : r.where === "github"
                    ? "in the build repository's secrets — checked by the build itself"
                    : r.description}
              </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mono w-44 shrink-0 text-[13px]">{label}</span>
      <span className="mono min-w-0 flex-1 truncate rounded-lg bg-ink-400/[0.06] px-3 py-2 text-[13px]">{value}</span>
      <Btn variant="secondary" onClick={onCopy}>
        <Copy className="h-4 w-4" /> Copy
      </Btn>
    </div>
  );
}

/* ───────────────────────── Start a build ───────────────────────── */

function StartBuild({ sum, companies, onStarted, toast, busy, setBusy }: any) {
  const [companyId, setCompanyId] = useState("");
  const [platform, setPlatform] = useState("android");
  const [target, setTarget] = useState<"test" | "store">("test");
  const [all, setAll] = useState(false);
  const withApp = useMemo(() => companies.filter((c: any) => c.hasApp).length, [companies]);
  const picked = companies.find((c: any) => String(c._id) === companyId);

  /**
   * Nobody can have an app before the first one is built, so "every company" is a guaranteed nothing until
   * at least one exists. It used to stay pressable and answer "0 builds started", which says what happened
   * and not one word about why.
   */
  useEffect(() => {
    if (all && withApp === 0) setAll(false);
  }, [all, withApp]);

  const go = async () => {
    setBusy("build");
    try {
      const r = await api<any>("/sa/mobile-releases/build", { body: { companyId: companyId || undefined, platform, target, all } });
      if (all) toast(r.started ? "ok" : "err", r.started ? `${r.started} build${r.started === 1 ? "" : "s"} started${r.skipped ? `, ${r.skipped} skipped` : ""}` : r.message || "Nothing was started.");
      else toast("ok", picked && !picked.hasApp ? "First build started — it takes 10–20 minutes and fixes this company's application id." : "Build started — it takes 10–20 minutes");
      onStarted();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="card mb-5 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Hammer className="h-5 w-5 text-hive-700" />
        <h3 className="font-bold">Start a build</h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Company">
          <select className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={all}>
            <option value="">Pick a company…</option>
            {companies.map((c: any) => (
              <option key={c._id} value={c._id}>
                {c.name} ({c.code}){c.hasApp ? "" : " · no app yet"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Platform">
          <div className="flex gap-2 pt-1">
            {["android", "ios"].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                disabled={p === "ios" && !sum.setup.ios}
                className={`rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-40 ${platform === p ? "bg-hive-600 text-white" : "bg-ink-400/[0.07] text-ink-700"}`}
              >
                {platformLabel(p)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="What it is for">
          <div className="flex gap-2 pt-1">
            {(["test", "store"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTarget(t)}
                className={`rounded-xl px-4 py-2 text-sm font-bold ${target === t ? "bg-hive-600 text-white" : "bg-ink-400/[0.07] text-ink-700"}`}
              >
                {t === "test" ? "Direct install" : "Store upload"}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Scope">
          <label className="flex items-center gap-2 pt-3 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-hive-700 disabled:opacity-40" checked={all} disabled={withApp === 0} onChange={(e) => setAll(e.target.checked)} />
            Every company that already has an app ({withApp})
          </label>
          {withApp === 0 && (
            <p className="mt-1.5 text-xs text-honey-800">
              No company has an app yet, so there is nothing to rebuild. Pick a company above and build its first one.
            </p>
          )}
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-ink-500">
          <span className="font-semibold text-ink-700">{targetHint(platform, target)}</span> One build per company. Every build carries the platform's version; building again gives the next build number. A company with no app yet is skipped by “every company” — its first build decides the application id and the signing key, so it is always started by hand.
        </p>
        <Btn onClick={go} loading={busy === "build"} disabled={!sum.setup.ok || (all ? withApp === 0 : !companyId)}>
          <Hammer className="h-4 w-4" /> Start build
        </Btn>
      </div>
    </section>
  );
}

/* ───────────────────────── Every build ───────────────────────── */

function Builds({ companies }: { companies: any[] }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ companyId: "", platform: "", status: "" });

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), limit: String(PAGE) });
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    const r = await api<any>(`/sa/mobile-releases/builds?${q}`, { fresh: true }).catch(() => null);
    if (r) {
      setRows(r.builds || []);
      setTotal(r.total || 0);
    }
  }, [page, f]);

  useEffect(() => {
    load();
  }, [load]);

  // something running: look again until it finishes
  useEffect(() => {
    if (!rows?.some((b) => b.status === "queued" || b.status === "building")) return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [rows, load]);

  const set = (k: string, v: string) => {
    setPage(1);
    setF((p) => ({ ...p, [k]: v }));
  };

  return (
    <section className="card p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-400/15 p-4">
        <h3 className="font-bold">
          Builds <span className="text-ink-500">· {total}</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          <select className="input max-w-[14rem]" value={f.companyId} onChange={(e) => set("companyId", e.target.value)}>
            <option value="">All companies</option>
            {companies.map((c: any) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input max-w-[10rem]" value={f.platform} onChange={(e) => set("platform", e.target.value)}>
            <option value="">All platforms</option>
            <option value="android">Android</option>
            <option value="ios">iOS</option>
          </select>
          <select className="input max-w-[10rem]" value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">Any status</option>
            {["queued", "building", "ready", "failed", "cancelled"].map((s) => (
              <option key={s} value={s}>
                {BUILD_LABEL[s as BuildStatus]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-14 text-hive-700">
          <Spinner className="h-5 w-5" />
        </div>
      ) : rows.length === 0 ? (
        <Empty title="No builds match" hint="Change the filters, or start one above." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr>
                  {["Company", "App", "Version", "Status", "Started", "By", ""].map((h) => (
                    <th key={h} className="th">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b._id} className="hover:bg-hive-50/40">
                    <td className="td font-semibold">
                      {b.company}
                      <span className="mono ml-2 text-[11px] text-ink-400">{b.companyCode}</span>
                    </td>
                    <td className="td text-sm">
                      {platformLabel(b.platform)}
                      {b.target === "store" && <span className="ml-2"><Badge color="honey">Store</Badge></span>}
                      <span className="mono block text-[11px] text-ink-400">{b.bundleId}</span>
                    </td>
                    <td className="td whitespace-nowrap font-semibold">
                      v{b.version}
                      <span className="ml-2 text-[11px] font-normal text-ink-400">build {b.buildNumber}</span>
                    </td>
                    <td className="td">
                      <Badge color={TONE[b.status as BuildStatus]}>{BUILD_LABEL[b.status as BuildStatus]}</Badge>
                      {b.error && <p className="mt-1 max-w-[260px] text-xs text-red-600">{b.error}</p>}
                      {b.store?.message && <p className={`mt-1 max-w-[260px] text-xs ${b.store.uploaded ? "text-emerald-700" : "text-ink-500"}`}>{b.store.message}</p>}
                    </td>
                    <td className="td whitespace-nowrap text-xs text-ink-500">{fmtDate(b.startedAt, false)}</td>
                    <td className="td text-xs text-ink-500">
                      {b.startedBy}
                      {b.trigger && b.trigger !== "manual" && <span className="block text-[11px] text-ink-400">{b.trigger === "push" ? "on a push" : "every company"}</span>}
                    </td>
                    <td className="td text-right">
                      {b.runUrl && (
                        <a href={b.runUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-hive-700 hover:underline">
                          Run <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > PAGE && (
            <div className="flex items-center justify-between gap-3 border-t border-ink-400/15 p-3 text-sm">
              <span className="text-ink-500">
                Page {page} of {Math.ceil(total / PAGE)}
              </span>
              <div className="flex gap-2">
                <Btn variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Btn>
                <Btn variant="secondary" disabled={page >= Math.ceil(total / PAGE)} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Btn>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

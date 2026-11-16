"use client";
/**
 * Super Admin › Company › Mobile App — name and brand the company's apps, build them, and see every build.
 *
 * The platform never holds a signing key: Android and iOS certificates live in the build repository's own
 * GitHub secrets. What this screen does is decide what the app is called, what it looks like and what it is
 * allowed to show, then ask GitHub to build it.
 */
import { useCallback, useEffect, useState } from "react";
import { Smartphone, Hammer, Download, RotateCcw, Trash2, Save, ExternalLink, CheckCircle2, XCircle, Clock, AlertTriangle, Upload, Apple, Loader2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Field, Btn, Badge, Spinner, Empty, Confirm, useToast } from "@/components/ui";
import { platformLabel, BUILD_LABEL, type BuildStatus } from "@shared/mobile";

const size = (n?: number) => (!n ? "—" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const TONE: Record<BuildStatus, "green" | "honey" | "red" | "gray"> = { ready: "green", building: "honey", queued: "gray", failed: "red", cancelled: "gray" };

export function MobileAppTab({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [kill, setKill] = useState<any>(null);
  const toast = useToast();

  const load = useCallback(
    () =>
      api(`/sa/companies/${id}/mobile`).then((r) => {
        setD(r);
        setForm({ ...r.config, ...r.saved });
        setDirty(false);
      }),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);

  // a build that is running: look again every 20 seconds until it finishes
  useEffect(() => {
    if (!d?.builds?.some((b: any) => b.status === "queued" || b.status === "building")) return;
    const t = setInterval(() => load(), 20_000);
    return () => clearInterval(t);
  }, [d, load]);

  if (!d)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const set = (k: string, v: any) => {
    setDirty(true);
    setForm((p: any) => ({ ...p, [k]: v }));
  };
  const hasReady = d.builds?.some((b: any) => b.status === "ready");
  const running = d.builds?.find((b: any) => b.status === "queued" || b.status === "building");

  async function save() {
    setBusy("save");
    try {
      const body = { appName: form.appName, shortName: form.shortName, bundleId: form.bundleId, primary: form.primary, accent: form.accent, platforms: form.platforms, screens: form.screens, autoBuild: !!form.autoBuild, storeListing: form.storeListing };
      await api(`/sa/companies/${id}/mobile`, { method: "PUT", body });
      toast("ok", "Saved");
      await load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }
  async function build(platform: string) {
    setBusy(platform);
    try {
      await api(`/sa/companies/${id}/mobile/build`, { body: { platform } });
      toast("ok", `${platformLabel(platform)} build started — it takes 10–20 minutes`);
      await load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy("");
    }
  }
  async function icon(file?: File | null) {
    if (!file) return;
    setBusy("icon");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`/sa/companies/${id}/mobile/icon`, { form: fd });
      toast("ok", "Icon uploaded — it is used by the next build");
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
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
        <p className="min-w-0 flex-1">
          This company's own Android and iOS apps. Each build carries the company's name, icon, colours and its own address, and is signed and kept in <span className="mono">{d.prefix}/</span>. Signing keys stay in the build repository's GitHub secrets — the platform never holds one. Set-up is explained in <b>Knowledge Base › GitHub build</b>.
        </p>
      </div>

      {!d.setup?.ok && (
        <div className="flex items-start gap-3 rounded-2xl border border-honey-500/40 bg-honey-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-honey-700" />
          <div>
            <p className="font-semibold text-ink-900">Builds are not set up yet.</p>
            <p className="text-ink-700">
              Missing: <b>{(d.setup.missing || []).join(", ")}</b>. Add them to the platform's environment, then this page can build.
            </p>
          </div>
        </div>
      )}

      {/* what the app is called and how it looks */}
      <section className="rounded-2xl border border-ink-400/15 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold">The app</h3>
          <Btn type="button" onClick={save} loading={busy === "save"} disabled={!canEdit || !dirty}>
            <Save className="h-4 w-4" /> Save
          </Btn>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="App name" hint="On the home screen and in the store listing">
            <input className="input" value={form.appName || ""} onChange={(e) => set("appName", e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="Short name" hint="Under the icon, when the full name does not fit">
            <input className="input" maxLength={20} value={form.shortName || ""} onChange={(e) => set("shortName", e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="Application id" hint={hasReady ? "Fixed — a new id is a different app on the phone" : "e.g. in.credoone.lms.whd"}>
            <input className="input mono disabled:bg-ink-400/5" value={form.bundleId || ""} onChange={(e) => set("bundleId", e.target.value.toLowerCase())} disabled={!canEdit || hasReady} />
          </Field>
          <Field label="Platforms">
            <div className="flex gap-4 pt-2.5">
              {["android", "ios"].map((p) => (
                <label key={p} className={`flex items-center gap-2 text-sm font-semibold ${p === "ios" && !d.ios ? "opacity-50" : ""}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-hive-700"
                    disabled={!canEdit || (p === "ios" && !d.ios)}
                    checked={(form.platforms || ["android"]).includes(p)}
                    onChange={(e) => set("platforms", e.target.checked ? [...(form.platforms || []), p] : (form.platforms || []).filter((x: string) => x !== p))}
                  />
                  {platformLabel(p)}
                  {p === "ios" && !d.ios && <span className="text-[11px] font-normal text-ink-500">· signing not switched on</span>}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Brand colour">
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Brand colour" className="h-11 w-14 cursor-pointer rounded-xl border border-ink-400/25 bg-white p-1" value={form.primary || "#2f5c24"} onChange={(e) => set("primary", e.target.value)} disabled={!canEdit} />
              <input className="input font-mono" value={form.primary || ""} onChange={(e) => set("primary", e.target.value)} disabled={!canEdit} />
            </div>
          </Field>
          <Field label="App icon" hint="PNG, 1024×1024 — used by the next build">
            <label className={`btn-secondary inline-flex items-center gap-2 ${canEdit ? "cursor-pointer" : "pointer-events-none opacity-50"}`}>
              <Upload className="h-4 w-4" /> {busy === "icon" ? "Uploading…" : form.iconKey ? "Replace icon" : "Upload icon"}
              <input type="file" accept="image/png" className="sr-only" onChange={(e) => icon(e.target.files?.[0])} />
            </label>
          </Field>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          What the app may show follows the <b>Mobile Modules</b> tab and each user's role — both are read when the app starts, so changing them needs no new build.
        </p>
      </section>

      {/* build */}
      <section className="rounded-2xl border border-ink-400/15 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold">Build</h3>
            <p className="text-sm text-ink-500">
              Takes 10–20 minutes. {running ? `A ${platformLabel(running.platform)} build is running now.` : "The finished file appears below and on the company's own Mobile App page."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(form.platforms || ["android"]).map((p: string) => (
              <Btn key={p} type="button" variant={p === "android" ? "primary" : "secondary"} loading={busy === p} disabled={!canEdit || !d.setup?.ok || !!running || (p === "ios" && !d.ios)} onClick={() => build(p)}>
                {p === "ios" ? <Apple className="h-4 w-4" /> : <Hammer className="h-4 w-4" />} Build {platformLabel(p)}
              </Btn>
            ))}
          </div>
        </div>

        {d.builds?.length ? (
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink-400/15">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  {["Version", "Platform", "Status", "Size", "Started", "", ""].map((h) => (
                    <th key={h} className="th">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.builds.map((b: any) => (
                  <tr key={b._id} className="hover:bg-hive-50/40">
                    <td className="td font-semibold">
                      v{b.version}
                      <span className="mono ml-2 text-[11px] text-ink-400">{b.bundleId}</span>
                    </td>
                    <td className="td">{platformLabel(b.platform)}</td>
                    <td className="td">
                      <Badge color={TONE[b.status as BuildStatus]}>{BUILD_LABEL[b.status as BuildStatus]}</Badge>
                      {b.error && <p className="mt-1 max-w-[280px] text-xs text-red-600">{b.error}</p>}
                    </td>
                    <td className="td whitespace-nowrap text-sm text-ink-600">{size(b.fileSize)}</td>
                    <td className="td whitespace-nowrap text-xs text-ink-500">
                      {fmtDate(b.startedAt, false)}
                      <span className="block">{b.startedBy}</span>
                    </td>
                    <td className="td">
                      {b.runUrl && (
                        <a href={b.runUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-hive-700 hover:underline">
                          Run <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                    <td className="td text-right">
                      {b.status === "ready" && (
                        <a className="btn-ghost inline-flex" href={`/api/sa/companies/${id}/mobile/download/${b._id}`} title="Download">
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      {(b.status === "queued" || b.status === "building") && canEdit && (
                        <button className="btn-ghost" title="Cancel" onClick={() => api(`/sa/companies/${id}/mobile/build/${b._id}/cancel`, { method: "POST" }).then(load)}>
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                      {b.status !== "building" && b.status !== "queued" && canEdit && (
                        <button className="btn-ghost text-red-600 hover:bg-red-50" title="Delete" onClick={() => setKill(b)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No builds yet" hint="Press Build Android to make this company's first app." />
        )}
      </section>

      {/* what the set-up looks like right now */}
      {d.setup?.requirements && (
        <section className="rounded-2xl border border-ink-400/15 bg-white p-5">
          <h3 className="mb-1 font-bold">Your set-up now</h3>
          <p className="mb-3 text-xs text-ink-500">
            Repository <span className="mono">{d.setup.repo || "— not set —"}</span> · workflow <span className="mono">{d.setup.workflow}</span> · branch <span className="mono">{d.setup.ref}</span>
          </p>
          <div className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {d.setup.requirements.map((r: any) => (
              <div key={r.key} className="flex items-start gap-2 text-sm">
                {r.set === true ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-hive-700" /> : r.set === false ? <XCircle className={`mt-0.5 h-4 w-4 shrink-0 ${r.required ? "text-red-600" : "text-ink-300"}`} /> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" />}
                <span className="min-w-0">
                  <span className="mono text-[12px]">{r.key}</span>
                  <span className="block text-xs text-ink-500">{r.where === "github" ? "in the build repository's secrets — checked by the build itself" : r.description}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <Confirm
        open={!!kill}
        danger
        title="Delete this build?"
        body={`v${kill?.version} and its file are removed. Anyone who already installed it keeps it; they simply cannot download it again.`}
        confirmLabel="Delete"
        onClose={() => setKill(null)}
        onConfirm={async () => {
          try {
            await api(`/sa/companies/${id}/mobile/build/${kill._id}`, { method: "DELETE" });
            toast("ok", "Deleted");
            await load();
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </div>
  );
}

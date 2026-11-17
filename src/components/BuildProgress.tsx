"use client";
/**
 * A running build: how far it has got, and the three things that can be done to it.
 *
 * Used by Super Admin › Company › Mobile App and by Mobile App Release, so one build looks and behaves the
 * same wherever it is being watched.
 *
 * **Pause is not a freeze, and the screen says so.** GitHub Actions has no way to suspend a run and pick it
 * up later — a run is either going or cancelled. Pause therefore cancels the run and remembers the version
 * and build number, and Resume starts that same version again from the beginning. Writing "Resume starts it
 * again (same version)" under the bar is the whole reason this is honest rather than a lie with a button.
 */
import { useState } from "react";
import { Pause, Play, Square, Loader2 } from "lucide-react";

export type BuildRow = {
  _id: string;
  status: string;
  progress?: number;
  phase?: string;
  version: string;
  platform: string;
  target?: string;
  pausedBy?: string;
  company?: string;
  companyCode?: string;
  error?: string;
};

const RUNNING = ["queued", "building"];
export const isLive = (b: { status: string }) => RUNNING.includes(b.status) || b.status === "paused";

/**
 * The bar.
 *
 * A queued build sits at a visible minimum rather than at zero: a bar with nothing in it reads as "nothing
 * is happening", when in fact the job is waiting for a machine — which is what the sentence beneath says.
 */
export function ProgressBar({ value, status }: { value: number; status: string }) {
  const pct = Math.max(status === "paused" ? value : Math.max(value, 2), 0);
  const tone =
    status === "paused" ? "bg-amber-500" : status === "failed" || status === "cancelled" ? "bg-red-500" : status === "ready" ? "bg-green-600" : "bg-hive-600";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function BuildControls({
  build,
  base,
  canEdit,
  onDone,
  compact,
}: {
  build: BuildRow;
  /** Where the three actions live, e.g. `/sa/companies/<id>/mobile/build` or `/sa/mobile-releases/build`. */
  base: string;
  canEdit: boolean;
  onDone: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [err, setErr] = useState("");

  if (!canEdit || !isLive(build)) return null;

  const act = async (what: "pause" | "resume" | "stop") => {
    setBusy(what);
    setErr("");
    try {
      const res = await fetch(`/api${base}/${build._id}/${what}`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || body?.message || `That did not work (${res.status}).`);
      // a cancel that GitHub would not take is worth saying, but it is not a failure of the action itself
      if (body?.note) setErr(body.note);
      setConfirmStop(false);
      onDone();
    } catch (e: any) {
      setErr(e?.message || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const Icon = ({ which }: { which: string }) =>
    busy === which ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : which === "pause" ? <Pause className="h-3.5 w-3.5" /> : which === "resume" ? <Play className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />;

  const btn = "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition disabled:opacity-50";

  return (
    <div className={`flex items-center gap-1.5 ${compact ? "" : "shrink-0"}`}>
      {err && <span className="mr-1 text-[11px] font-semibold text-amber-700">{err}</span>}

      {confirmStop ? (
        <>
          <span className="text-xs font-bold text-amber-700">Stop this build?</span>
          <button className={`${btn} border-red-300 text-red-700 hover:bg-red-50`} disabled={!!busy} onClick={() => act("stop")}>
            <Icon which="stop" /> Yes, stop
          </button>
          <button className={`${btn} border-ink-200 text-ink-700 hover:bg-ink-50`} disabled={!!busy} onClick={() => setConfirmStop(false)}>
            No
          </button>
        </>
      ) : (
        <>
          {RUNNING.includes(build.status) && (
            <button className={`${btn} border-amber-300 text-amber-700 hover:bg-amber-50`} disabled={!!busy} onClick={() => act("pause")} title="Cancels the run and keeps this version — Resume starts it again">
              <Icon which="pause" /> Pause
            </button>
          )}
          {build.status === "paused" && (
            <button className={`${btn} border-green-300 text-green-700 hover:bg-green-50`} disabled={!!busy} onClick={() => act("resume")} title="Starts this same version again, from the beginning">
              <Icon which="resume" /> Resume
            </button>
          )}
          <button className={`${btn} border-red-300 text-red-700 hover:bg-red-50`} disabled={!!busy} onClick={() => setConfirmStop(true)}>
            <Icon which="stop" /> Stop
          </button>
        </>
      )}
    </div>
  );
}

/** One running build, as a row: name, percentage, controls, bar and the sentence underneath. */
export function BuildProgressRow({ build, base, canEdit, onDone, title }: { build: BuildRow; base: string; canEdit: boolean; onDone: () => void; title?: React.ReactNode }) {
  const pct = Math.round(build.progress || 0);
  const paused = build.status === "paused";
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {paused ? <Pause className="h-4 w-4 shrink-0 text-amber-600" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-hive-600" />}
        <span className="text-sm font-extrabold">{title}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className={`text-xs font-extrabold ${paused ? "text-amber-700" : "text-ink-600"}`}>{paused ? "Paused" : `${pct}%`}</span>
          <BuildControls build={build} base={base} canEdit={canEdit} onDone={onDone} />
        </span>
      </div>
      <ProgressBar value={pct} status={build.status} />
      <p className="mt-1.5 text-[11px] text-ink-500">
        {build.phase || (build.status === "queued" ? "Waiting for a build machine" : "Working")}
        {paused && <span className="text-amber-700"> — Resume starts it again (same version)</span>}
      </p>
    </div>
  );
}

import { api } from "./api";

export type JobView = { _id: string; type: string; status: "queued" | "running" | "done" | "failed" | "dead"; progress?: { done: number; total: number }; attempts?: number; error?: string; result?: any; nextAttemptAt?: string };

/**
 * Follow a background job until it finishes. Each poll also advances the job by one slice on the server, so progress
 * keeps moving while the screen is open. Polls back off from 1 s to 4 s. Resolves with the final job (done or dead).
 */
export async function followJob(job: JobView, onUpdate?: (j: JobView) => void, signal?: { cancelled: boolean }) {
  let j = job;
  let wait = 1000;
  onUpdate?.(j);
  while (j.status !== "done" && j.status !== "dead" && !signal?.cancelled) {
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(4000, wait * 1.4);
    try {
      j = await api<JobView>(`/co/jobs/${j._id}`);
      onUpdate?.(j);
    } catch {
      /* network blip — keep polling */
    }
  }
  return j;
}

export const pct = (j?: JobView | null) => (j?.progress?.total ? Math.min(100, Math.round((j.progress.done / j.progress.total) * 100)) : j?.status === "done" ? 100 : 0);

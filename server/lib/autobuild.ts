/**
 * Rebuilding every company's app when the app's code changes.
 *
 * A push to the build repository means the app itself has changed, so every company whose app is set to
 * rebuild automatically gets a fresh build with its own name, icon, colours and address. GitHub tells the
 * platform about the push in one of two ways — a step in the repository's own workflow, or a repository
 * webhook — and both arrive here, signed.
 *
 * It is deliberately quiet about what it refuses: a company with no app yet is skipped rather than given a
 * first build nobody asked for, and a company already building is left alone.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { Company, MobileBuild, PlatformSetting } from "../models";
import { startBuild } from "./mobilebuild";

const env = (k: string) => (process.env[k] || "").trim();
const KEY = "mobile.autobuild";

export interface AutoBuildState {
  on: boolean;
  branch: string;
  secret: string;
  lastPush?: { sha: string; message: string; at: Date; builds: number; companies: number };
}

export async function state(): Promise<AutoBuildState> {
  const row = await PlatformSetting.findById(KEY).lean<any>();
  const v = row?.value || {};
  return { on: !!v.on, branch: v.branch || env("GITHUB_BUILD_REF") || "main", secret: v.secret || "", lastPush: v.lastPush };
}

export async function saveState(patch: Partial<AutoBuildState>, by = "system") {
  const now = await state();
  const value = { ...now, ...patch };
  await PlatformSetting.updateOne({ _id: KEY }, { $set: { value: { ...value, updatedBy: by } } }, { upsert: true });
  return value;
}

/** A new secret to paste into GitHub. The old one stops working the moment this is saved. */
export const newSecret = () => createHmac("sha256", `${Date.now()}`).update(Math.random().toString(36)).digest("hex");

/** GitHub signs the body; both the workflow step and a repository webhook use this same shape. */
export function pushSignatureValid(raw: string, header: string | undefined, secret: string) {
  if (!header || !secret) return false;
  const mine = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(mine);
  const b = Buffer.from(String(header));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Rebuilds every company that is set to rebuild automatically and already has an app. Returns what it did,
 * which is what the screen shows under the last push.
 */
export async function rebuildAll(by: string, trigger: "push" | "auto" = "push") {
  const companies = await Company.find({ deletedAt: null, status: "active", "mobile.autoBuild": true }).lean<any[]>();
  let builds = 0;
  const touched = new Set<string>();
  const problems: string[] = [];

  for (const c of companies) {
    // only an app that exists is rebuilt — a first build is always someone's decision, never a side effect
    const platforms: string[] = c.mobile?.platforms?.length ? c.mobile.platforms : ["android"];
    for (const p of platforms) {
      if (!(await MobileBuild.exists({ companyId: c._id, platform: p, status: "ready" }))) continue;
      if (await MobileBuild.exists({ companyId: c._id, platform: p, status: { $in: ["queued", "building"] } })) continue;
      try {
        await startBuild(c, p as any, by, { trigger, notes: "Rebuilt because the app's code changed" });
        builds++;
        touched.add(String(c._id));
      } catch (e: any) {
        problems.push(`${c.code} ${p}: ${e?.message || e}`);
      }
    }
  }
  return { builds, companies: touched.size, problems };
}

/**
 * Building a company's Android / iOS app.
 *
 *   Super Admin presses Build
 *     → a MobileBuild row is created (queued) and the GitHub workflow is dispatched with everything the
 *       build needs: the company's code, name, colours, application id, version and its own address;
 *     → the workflow reports back as it goes (building → ready / failed), signing each message with
 *       MOBILE_BUILD_SECRET so nothing else can post a result;
 *     → the signed file is uploaded by the workflow to <COMPANY CODE>/app/<platform>/<version>/ and the
 *       key comes back with the result.
 *
 * The platform never holds a signing key: Android and iOS certificates live in the build repository's own
 * GitHub secrets, where a build can use them and nobody can read them back.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { Company, MobileBuild } from "../models";
import { tenantUrls } from "./tenant";
import { s3Area } from "../../shared/platform";
import { bundleIdFor, nextVersion, platformLabel, artifactExt, BUILD_REQUIREMENTS, type Platform, type MobileConfig, type BuildTarget } from "../../shared/mobile";
import { ensureKey, signingEnabled } from "./signing";
import { buildSecret, ensureBuildSecret } from "./buildsecret";

const env = (k: string) => (process.env[k] || "").trim();
export const buildRepo = () => env("GITHUB_BUILD_REPO");
export const buildWorkflow = () => env("GITHUB_BUILD_WORKFLOW") || "build-mobile.yml";
export const buildRef = () => env("GITHUB_BUILD_REF");
export const iosEnabled = () => env("MOBILE_IOS_SIGNING") === "1";

/** Which requirements are met — the Knowledge Base article and the Mobile App tab both show this. */
/**
 * `platformHeld` are the settings the platform keeps for you when the environment does not set them, so the
 * checklist must not call them missing. `setupState` takes the ones it has been told about.
 */
export function setupState(platformHeld: Record<string, boolean> = {}) {
  return BUILD_REQUIREMENTS.map((r) => {
    const value = r.where === "platform" ? env(r.key) : "";
    const held = !value && !!platformHeld[r.key]; // kept by the platform rather than set here
    // a value that is present but unusable used to pass silently and then fail the build with a 404
    const problem = r.where === "platform" && value && r.check ? r.check(value) : null;
    // a warning is shown but never blocks — see BuildRequirement.warn
    const warning = !problem && r.where === "platform" && value && r.warn ? r.warn(value) : null;
    return {
      ...r,
      check: undefined, // a function cannot be sent to the browser
      warn: undefined,
      // only the platform's own settings can be checked from here; the repository's secrets are checked by the build itself
      set: r.where === "platform" ? !!value || held : null,
      heldByPlatform: held,
      problem: problem || warning,
      blocking: !!problem,
      value: r.where === "platform" && !r.secret ? value || null : null,
    };
  });
}

/**
 * Whether a build can be started at all. A setting that is present but malformed counts as missing, because
 * a build started with it fails on GitHub a minute later with nothing useful to show for it.
 */
export function readyToBuild(platformHeld: Record<string, boolean> = {}) {
  const bad = BUILD_REQUIREMENTS.filter((r) => {
    if (r.where !== "platform") return false;
    const v = env(r.key);
    if (r.required && !v && !platformHeld[r.key]) return true;
    return !!(v && r.check && r.check(v));
  }).map((r) => r.key);
  return { ok: !bad.length, missing: bad };
}

/** The settings a company's app is built with, filled in from the company where it has not been set. */
export function appConfig(company: any): Required<Pick<MobileConfig, "appName" | "bundleId" | "primary" | "accent">> & MobileConfig {
  const m: MobileConfig = company.mobile || {};
  const urls = tenantUrls(company);
  return {
    ...m,
    appName: m.appName || company.whiteLabel?.appNames?.mobile || company.branding?.shortName || company.name,
    shortName: m.shortName || company.branding?.shortName || company.name,
    bundleId: bundleIdFor(env("MOBILE_PACKAGE_PREFIX"), company.code, m.bundleId),
    primary: m.primary || company.branding?.themeColor || "#2f5c24",
    accent: m.accent || company.branding?.accentColor || "#d9b52a",
    platforms: m.platforms?.length ? m.platforms : (["android"] as Platform[]),
    apiBase: urls.customUrl || urls.platformUrl,
  } as any;
}

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/**
 * Checks the signature the workflow sends with its result.
 *
 * With no secret anywhere this refuses, and deliberately so. It used to fall back to the literal string
 * "dev" — a value printed in this file — which meant an unconfigured platform accepted anything that knew
 * to sign with it. A missing secret must fail closed; the platform makes one on its own now, so there is no
 * reason for it to be missing.
 */
export async function callbackValid(raw: string, header?: string) {
  if (!header) return false;
  const { value } = await buildSecret();
  if (!value) return false;
  const mine = Buffer.from(sign(raw, value));
  const theirs = Buffer.from(String(header));
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
}

/** Starts a build and dispatches the workflow. Throws with a plain reason when something is not set up. */
export async function startBuild(company: any, platform: Platform, by: string, opts: { notes?: string; trigger?: "manual" | "push" | "auto"; target?: BuildTarget } = {}) {
  /**
   * The shared secret is made before the gate is checked, not after — it is one of the things the gate looks
   * for. Checking first meant the panel said "ready" (because it knew the platform keeps the secret) while
   * this refused the build for a variable that is deliberately empty. The gate must be given the same
   * knowledge the panel has, or the two disagree and only one of them is on screen.
   */
  const { value: secret } = await ensureBuildSecret(by);
  const gate = readyToBuild({ MOBILE_BUILD_SECRET: !!secret });
  if (!gate.ok) throw new Error(`Not set up yet — missing ${gate.missing.join(", ")}. See Knowledge Base › GitHub build.`);
  if (company.s3Enabled === false) throw new Error("Switch on S3 storage for this company — the finished app is kept in its folder");
  if (platform === "ios" && !iosEnabled()) throw new Error("iOS signing is not switched on yet (MOBILE_IOS_SIGNING=1 once the certificates are in the repository's secrets)");
  if (await MobileBuild.exists({ companyId: company._id, platform, status: { $in: ["queued", "building"] } })) throw new Error(`An ${platformLabel(platform)} build is already running for this company`);

  const cfg = appConfig(company);
  // Android needs one permanent key for the life of the app, so it is made (once) before anything is queued
  let signing: any = null;
  if (platform === "android" && signingEnabled()) signing = await ensureKey(company, by);

  const n = (await MobileBuild.countDocuments({ companyId: company._id, platform })) + 1;
  const version = nextVersion(env("MOBILE_BASE_VERSION") || "1.0.0", n);
  const build = await MobileBuild.create({
    companyId: company._id,
    companyCode: company.code,
    platform,
    version,
    buildNumber: n,
    bundleId: cfg.bundleId,
    appName: cfg.appName,
    status: "queued",
    notes: opts.notes,
    target: opts.target || "test",
    trigger: opts.trigger || "manual",
    signedBy: platform === "android" ? (signing ? "platform" : "github") : "github",
    signingFingerprint: signing?.fingerprint,
    startedBy: by,
    startedAt: new Date(),
  });

  const inputs = {
    build_id: String(build._id),
    company_code: String(company.code).toUpperCase(),
    company_name: cfg.appName,
    platform,
    version,
    build_number: String(n),
    bundle_id: cfg.bundleId,
    primary: cfg.primary,
    accent: cfg.accent,
    api_base: (cfg as any).apiBase || "",
    s3_prefix: s3Area(company.code, "app", platform, version),
    callback_url: `${(cfg as any).apiBase || env("APP_BASE_URL")}/api/public/mobile/build`,
    // where the build collects the signing key — never the key itself, which a workflow input would print
    signing_url: signing ? `${(cfg as any).apiBase || env("APP_BASE_URL")}/api/public/mobile/signing/${build._id}` : "",
    // "test" makes an .apk / ad-hoc .ipa; "store" makes an .aab / App Store .ipa and uploads it if it can
    target: opts.target || "test",
  };

  try {
    const res = await fetch(`https://api.github.com/repos/${buildRepo()}/actions/workflows/${encodeURIComponent(buildWorkflow())}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("GITHUB_BUILD_TOKEN")}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: buildRef() || (await defaultBranch()), inputs }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(res.status === 404 ? `GitHub refused the build (404). Push .github/workflows/${buildWorkflow()} to the branch and open the Actions tab once so Actions are enabled.` : `GitHub refused the build (${res.status}): ${text}`);
    }
  } catch (e: any) {
    await MobileBuild.updateOne({ _id: build._id }, { $set: { status: "failed", error: e.message, finishedAt: new Date() } });
    throw e;
  }
  return build.toObject();
}

let branchCache: { at: number; name: string } | null = null;
async function defaultBranch() {
  if (branchCache && Date.now() - branchCache.at < 600_000) return branchCache.name;
  try {
    const r = await fetch(`https://api.github.com/repos/${buildRepo()}`, { headers: { Authorization: `Bearer ${env("GITHUB_BUILD_TOKEN")}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) });
    const j: any = await r.json();
    branchCache = { at: Date.now(), name: j?.default_branch || "main" };
  } catch {
    branchCache = { at: Date.now(), name: "main" };
  }
  return branchCache.name;
}

/** What the workflow sends back as it goes. */
export async function updateBuild(
  buildId: string,
  patch: { status?: string; runId?: string; runUrl?: string; fileKey?: string; fileName?: string; fileSize?: number; sha256?: string; error?: string; store?: any }
) {
  const set: any = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null && v !== "") set[k] = v;
  if (patch.status === "ready" || patch.status === "failed") set.finishedAt = new Date();
  const build = await MobileBuild.findByIdAndUpdate(buildId, { $set: set }, { new: true }).lean<any>();
  return build;
}

/** A build that has been running far too long is marked failed, so the tab never shows a spinner for ever. */
export async function sweepStuckBuilds(maxMinutes = 90) {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000);
  const r = await MobileBuild.updateMany({ status: { $in: ["queued", "building"] }, startedAt: { $lt: cutoff } }, { $set: { status: "failed", error: `No result after ${maxMinutes} minutes — check the run on GitHub`, finishedAt: new Date() } });
  return r.modifiedCount || 0;
}

/** The builds a company can offer for download: the newest ready one per platform. */
/**
 * The newest finished build of each platform.
 *
 * `onlyInstallable` leaves out store builds, because an .aab and an App Store .ipa do not install on a phone
 * — offering one on a company's download page gives somebody a file that cannot work and no way to know why.
 * The Super Admin screens ask for everything; the download page asks for installable only.
 */
export async function latestReady(companyId: any, onlyInstallable = false) {
  const find: any = { companyId, status: "ready" };
  if (onlyInstallable) find.target = { $ne: "store" };
  const rows = await MobileBuild.find(find).sort({ createdAt: -1 }).limit(30).lean<any[]>();
  const out: Record<string, any> = {};
  for (const r of rows) if (!out[r.platform]) out[r.platform] = r;
  return out;
}

export const artifactName = (company: any, platform: string, version: string, target = "test") =>
  `${String(company.code).toLowerCase()}-${platform}-${version}.${artifactExt(platform, target)}`;

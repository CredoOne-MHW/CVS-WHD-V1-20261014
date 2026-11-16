/**
 * The company's own Android and iOS apps.
 *
 * One app source (mobile/) is built once per company and per platform: the company's name, icon, colours
 * and address are passed into the build, so each company gets a signed app of its own that talks only to
 * its own address. Builds run on GitHub Actions and the finished file is uploaded to that company's own S3
 * folder under <COMPANY CODE>/app/<platform>/<version>/.
 */

export const PLATFORMS = ["android", "ios"];
export type Platform = (typeof PLATFORMS)[number];
export const platformLabel = (p: string) => (p === "ios" ? "iOS" : "Android");
/**
 * What a build is FOR, which decides what comes out of it.
 *
 *   test  — an .apk you can hand to a phone directly, and an ad-hoc .ipa for registered devices.
 *   store — an .aab for Google Play and an App Store .ipa. Neither installs on a phone by hand: they are
 *           the formats the two stores accept, and nothing else.
 */
export const BUILD_TARGETS = ["test", "store"] as const;
export type BuildTarget = (typeof BUILD_TARGETS)[number];
export const TARGET_LABEL: Record<BuildTarget, string> = { test: "Direct install", store: "Store upload" };

export const artifactExt = (p: string, target: string = "test") =>
  p === "ios" ? "ipa" : target === "store" ? "aab" : "apk";

/** Said plainly, because handing someone an .aab to sideload wastes an afternoon. */
export const targetHint = (platform: string, target: BuildTarget) =>
  target === "store"
    ? platform === "ios"
      ? "An App Store build. It goes to App Store Connect, not onto a phone."
      : "An Android App Bundle (.aab) for Google Play. Google makes the phone-ready files from it — it does not install by hand."
    : platform === "ios"
      ? "An ad-hoc build, which installs only on devices registered to the provisioning profile."
      : "An .apk anyone can install directly from the download page.";

/** Where a build has got to. */
export const BUILD_STATUSES = ["queued", "building", "ready", "failed", "cancelled"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];
export const BUILD_LABEL: Record<BuildStatus, string> = {
  queued: "Queued",
  building: "Building",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** What the apps can show. Each one is a module key, so the Mobile Modules tab decides what appears. */
export const APP_SCREENS = [
  { key: "dashboard", label: "Dashboard", module: "dashboard", description: "Today's leads, follow-ups due and what was converted." },
  { key: "leads", label: "Leads", module: "leads", description: "The pipeline, with search and a lead's full history." },
  { key: "clients", label: "Clients", module: "clients", description: "Converted clients, their services and dues." },
  { key: "chats", label: "Chats", module: "chats", description: "One-to-one and group messages, with the scrolling notice at the top." },
  { key: "profile", label: "Profile", module: null, description: "The signed-in user, sign out, and the app's version.", always: true },
] as const;

/** A company's app settings — kept on the Company as `mobile`. */
export interface MobileConfig {
  enabled?: boolean;
  appName?: string; // shown on the home screen
  shortName?: string; // under the icon when the name is long
  bundleId?: string; // in.credoone.lms.<company> unless set
  iconKey?: string; // S3 key of the app icon (1024×1024)
  splashKey?: string;
  primary?: string; // falls back to the company's theme colour
  accent?: string;
  platforms?: Platform[];
  screens?: string[]; // APP_SCREENS keys; absent = every screen the modules allow
  storeListing?: { subtitle?: string; description?: string; privacyUrl?: string; supportEmail?: string };
  autoBuild?: boolean; // build again when the platform is updated
}

/** The next version for a company: <base>.<n>, as in 1.0.0.7 — n counts that company's builds. */
export function nextVersion(base: string, n: number) {
  const clean = (base || "1.0.0").trim().replace(/[^\d.]/g, "") || "1.0.0";
  return `${clean}.${Math.max(1, n)}`;
}

/** The application id, which can never change once an app is installed. */
export function bundleIdFor(prefix: string, code: string, override?: string) {
  if (override) return override;
  const clean = String(code || "app").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${(prefix || "in.credoone.lms").replace(/\.+$/, "")}.${clean}`;
}

/**
 * What the platform needs before a build can run. The Knowledge Base article checks each one and shows it
 * green or red; `where` says which of the two places it belongs to, because they are set differently.
 */
export interface BuildRequirement {
  key: string;
  where: "platform" | "github";
  label: string;
  description: string;
  required: boolean;
  secret?: boolean;
  /**
   * Checks the VALUE, not just that one was given. A setting that is present but unusable used to show a
   * green tick and then fail the build with a 404, which is the worst of both — so a value that cannot work
   * says so here, in the words of what to change.
   */
  check?: (value: string) => string | null;
  /**
   * A value that is not broken but is probably not what was meant. It shows in amber and does NOT stop a
   * build, because the alternative is blocking somebody who renamed a file on purpose. "Check GitHub setup"
   * is what settles it either way, by asking GitHub.
   */
  warn?: (value: string) => string | null;
}

/** The shapes a few settings must have, each with the correction rather than the complaint. */
export const SHAPE = {
  repo: (v: string) =>
    /^[\w.-]+\/[\w.-]+$/.test(v)
      ? null
      : `This goes straight into a GitHub address, so it must be just owner/repo — no https://, no github.com/, no .git. ${
          /github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?\/?$/.exec(v) ? `Use ${/github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?\/?$/.exec(v)![1]}` : ""
        }`.trim(),
  longSecret: (v: string) => (v.length >= 16 ? null : "Too short to be a secret. Make one with: openssl rand -hex 32"),
};

export const BUILD_REQUIREMENTS: BuildRequirement[] = [
  { key: "GITHUB_BUILD_REPO", where: "platform", label: "Build repository", description: "owner/repo holding this code and .github/workflows/build-mobile.yml", required: true, check: (v) => SHAPE.repo(v) },
  { key: "GITHUB_BUILD_TOKEN", where: "platform", label: "GitHub token", description: "Fine-grained token with Actions: read and write on that repository", required: true, secret: true },
  { key: "GITHUB_BUILD_REF", where: "platform", label: "Branch", description: "Branch to build from; empty uses the default branch", required: false },
  { key: "MOBILE_BUILD_SECRET", where: "platform", label: "Build callback secret", description: "The platform makes and keeps this one, so there is nothing to set here. It signs what a finished build reports back and proves a build may collect a signing key — the SAME value must also be a repository secret of this name, or builds run but never turn Ready.", required: true, secret: true, check: (v) => SHAPE.longSecret(v) },
  {
    key: "MOBILE_SIGNING_SECRET",
    where: "platform",
    label: "Platform-kept signing key",
    description: "One of these two is required for Android. Set this and the platform makes and keeps a permanent key for every company by itself — one value, nothing else to do. Leave it empty and the repository must hold the four ANDROID_* secrets instead. With neither, an Android build fails at the signing step.",
    required: false,
    secret: true,
    check: (v) => SHAPE.longSecret(v),
  },
  { key: "MOBILE_BASE_VERSION", where: "platform", label: "Base version", description: "Builds are numbered <base>.<n> per company", required: false },
  { key: "MOBILE_PACKAGE_PREFIX", where: "platform", label: "Application id prefix", description: "e.g. in.credoone.lms → in.credoone.lms.<company>", required: false },
  { key: "MOBILE_IOS_SIGNING", where: "platform", label: "iOS signing on", description: "Set to 1 once the iOS certificates are in the repository's secrets", required: false },
  { key: "S3_BUCKET", where: "platform", label: "S3 bucket", description: "Finished apps are uploaded to each company's folder", required: true },
  { key: "AWS_ACCESS_KEY_ID", where: "platform", label: "AWS key", description: "Must be able to write to that bucket", required: true, secret: true },
  {
    key: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
    where: "github",
    label: "Google Play service account",
    description: "Optional. A Play Console service-account key, so a store build uploads itself to the Internal testing track. Without it the .aab is made and kept for you to upload by hand.",
    required: false,
    secret: true,
  },
  {
    key: "APP_STORE_CONNECT_KEY_ID",
    where: "github",
    label: "App Store Connect key",
    description: "Optional, with APP_STORE_CONNECT_ISSUER_ID and APP_STORE_CONNECT_KEY_P8 — a store build then uploads itself to TestFlight. Without them the .ipa is made and kept.",
    required: false,
    secret: true,
  },
  { key: "ANDROID_KEYSTORE_BASE64", where: "github", label: "Android keystore", description: "base64 of the .jks — the SAME key for every rebuild, or Android refuses to update the app", required: true, secret: true },
  { key: "ANDROID_KEYSTORE_PASSWORD", where: "github", label: "Keystore password", description: "", required: true, secret: true },
  { key: "ANDROID_KEY_ALIAS", where: "github", label: "Key alias", description: "", required: true, secret: true },
  { key: "ANDROID_KEY_PASSWORD", where: "github", label: "Key password", description: "", required: true, secret: true },
  { key: "IOS_CERT_P12_BASE64", where: "github", label: "iOS certificate", description: "Only needed for iOS builds", required: false, secret: true },
  { key: "IOS_CERT_PASSWORD", where: "github", label: "Certificate password", description: "", required: false, secret: true },
  { key: "IOS_PROFILE_BASE64", where: "github", label: "Provisioning profile", description: "", required: false, secret: true },
  { key: "IOS_TEAM_ID", where: "github", label: "Apple team id", description: "", required: false },
] as const;

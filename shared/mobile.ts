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
export const artifactExt = (p: string) => (p === "ios" ? "ipa" : "apk");

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
}

export const BUILD_REQUIREMENTS: BuildRequirement[] = [
  { key: "GITHUB_BUILD_REPO", where: "platform", label: "Build repository", description: "owner/repo holding this code and .github/workflows/build-mobile.yml", required: true },
  { key: "GITHUB_BUILD_TOKEN", where: "platform", label: "GitHub token", description: "Fine-grained token with Actions: read and write on that repository", required: true, secret: true },
  { key: "GITHUB_BUILD_REF", where: "platform", label: "Branch", description: "Branch to build from; empty uses the default branch", required: false },
  { key: "GITHUB_BUILD_WORKFLOW", where: "platform", label: "Workflow file", description: "Defaults to build-mobile.yml", required: false },
  { key: "MOBILE_BUILD_SECRET", where: "platform", label: "Build callback secret", description: "Signs the message the finished build sends back. Must match the repository secret of the same name.", required: true, secret: true },
  { key: "MOBILE_BASE_VERSION", where: "platform", label: "Base version", description: "Builds are numbered <base>.<n> per company", required: false },
  { key: "MOBILE_PACKAGE_PREFIX", where: "platform", label: "Application id prefix", description: "e.g. in.credoone.lms → in.credoone.lms.<company>", required: false },
  { key: "MOBILE_IOS_SIGNING", where: "platform", label: "iOS signing on", description: "Set to 1 once the iOS certificates are in the repository's secrets", required: false },
  { key: "S3_BUCKET", where: "platform", label: "S3 bucket", description: "Finished apps are uploaded to each company's folder", required: true },
  { key: "AWS_ACCESS_KEY_ID", where: "platform", label: "AWS key", description: "Must be able to write to that bucket", required: true, secret: true },
  { key: "ANDROID_KEYSTORE_BASE64", where: "github", label: "Android keystore", description: "base64 of the .jks — the SAME key for every rebuild, or Android refuses to update the app", required: true, secret: true },
  { key: "ANDROID_KEYSTORE_PASSWORD", where: "github", label: "Keystore password", description: "", required: true, secret: true },
  { key: "ANDROID_KEY_ALIAS", where: "github", label: "Key alias", description: "", required: true, secret: true },
  { key: "ANDROID_KEY_PASSWORD", where: "github", label: "Key password", description: "", required: true, secret: true },
  { key: "IOS_CERT_P12_BASE64", where: "github", label: "iOS certificate", description: "Only needed for iOS builds", required: false, secret: true },
  { key: "IOS_CERT_PASSWORD", where: "github", label: "Certificate password", description: "", required: false, secret: true },
  { key: "IOS_PROFILE_BASE64", where: "github", label: "Provisioning profile", description: "", required: false, secret: true },
  { key: "IOS_TEAM_ID", where: "github", label: "Apple team id", description: "", required: false },
] as const;

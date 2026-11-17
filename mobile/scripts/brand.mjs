/**
 * Brands one build.
 *
 * The workflow passes a company's name, application id, colours, version and address; this writes them into
 * app.json before `expo prebuild`, so the finished app carries that company's identity and talks only to
 * that company's address. Run from the mobile/ folder.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";

const get = (k, fallback = "") => process.env[k] || fallback;
const name = get("APP_NAME", "CredoOne Leads");
const bundleId = get("BUNDLE_ID", "in.credoone.lms");
const version = get("APP_VERSION", "1.0.0");
const buildNumber = String(parseInt(get("BUILD_NUMBER", "1"), 10) || 1);
const primary = get("PRIMARY", "#2f5c24");

const app = JSON.parse(readFileSync("app.json", "utf8"));
const e = app.expo;
e.name = name;
e.slug = (get("COMPANY_CODE", "app").toLowerCase().replace(/[^a-z0-9-]/g, "") || "app") + "-lms";
e.version = version;
e.splash.backgroundColor = primary;
e.ios.bundleIdentifier = bundleId;
e.ios.buildNumber = buildNumber;
e.android.package = bundleId;
e.android.versionCode = Number(buildNumber);
e.android.adaptiveIcon.backgroundColor = primary;
// the notification tint follows the company's colour too, so a push looks like the company's app
if (e.notification) e.notification.color = primary;
const notifyPlugin = (e.plugins || []).find((p) => Array.isArray(p) && p[0] === "expo-notifications");
if (notifyPlugin) notifyPlugin[1] = { ...notifyPlugin[1], color: primary };

/**
 * The Android API level this is built against, overridable by the build.
 *
 * Google Play refuses an app that targets a level more than a year or so behind the current one, and that
 * bar moves every August. Keeping it here rather than hard-coded means raising it is a setting on the
 * platform, not a code change and a release — which matters because the day Play moves the bar is the day
 * an upload starts being refused.
 */
const sdk = parseInt(get("ANDROID_TARGET_SDK", "34"), 10) || 34;

/**
 * The highest API level each Expo SDK can be compiled against.
 *
 * This is not a preference, it is a hard limit, and getting it wrong costs five minutes of CI to find out.
 * Expo 51's own Kotlin source is written against API 34: in API 35 Android annotated
 * `PackageInfo.requestedPermissions` as nullable, so `expo-modules-core`'s
 *
 *     return requestedPermissions.contains(permission)
 *
 * stops compiling — "Only safe (?.) or non-null asserted (!!.) calls are allowed on a nullable receiver".
 * That is a failure inside Expo's code, which nothing here can patch; the only fix is to compile against
 * the level that Expo release supports, or to move to a newer Expo.
 *
 * Checked rather than clamped, because silently building something other than what was asked for is how
 * somebody ends up wondering why Play still rejects their upload.
 */
const MAX_SDK_FOR_EXPO = { 51: 34, 52: 35, 53: 35, 54: 36 };
const expoMajor = parseInt(String(JSON.parse(readFileSync("package.json", "utf8")).dependencies?.expo || "").replace(/^[^\d]*/, ""), 10);
const maxSdk = MAX_SDK_FOR_EXPO[expoMajor];

if (maxSdk && sdk > maxSdk) {
  console.log(
    `::error::Android API level ${sdk} was asked for, but Expo SDK ${expoMajor} can only be compiled against API ${maxSdk}. ` +
      `Building anyway fails inside expo-modules-core with "Only safe (?.) or non-null asserted (!!.) calls are allowed on a nullable receiver" — ` +
      `Expo's own source, which this build cannot patch. Either set ANDROID_TARGET_SDK=${maxSdk} on the platform, or upgrade the app to Expo SDK ${Object.keys(MAX_SDK_FOR_EXPO).find((k) => MAX_SDK_FOR_EXPO[k] >= sdk) || "52 or newer"}.`
  );
  process.exit(1);
}

const buildProps = (e.plugins || []).find((p) => Array.isArray(p) && p[0] === "expo-build-properties");
if (buildProps) {
  buildProps[1] = {
    ...buildProps[1],
    android: { ...(buildProps[1].android || {}), compileSdkVersion: sdk, targetSdkVersion: sdk, buildToolsVersion: `${sdk}.0.0` },
  };
  console.log(`Android compile/target SDK: ${sdk}${maxSdk ? ` (Expo SDK ${expoMajor} supports up to ${maxSdk})` : ""}`);
}
e.extra = {
  apiBase: get("API_BASE"),
  companyCode: get("COMPANY_CODE"),
  companyName: name,
  primary,
  accent: get("ACCENT", "#d9b52a"),
  buildVersion: version,
  buildNumber,
};
writeFileSync("app.json", JSON.stringify(app, null, 2) + "\n");

/**
 * The company's own icon, when the workflow managed to download one from its S3 folder.
 *
 * It replaces both icon shapes: the full-bleed one iOS and the stores use, and the Android adaptive
 * foreground. That second one is a compromise — Android masks it to a circle or squircle and will crop the
 * edges of a square logo — but a company's own icon cropped is better than the platform's default, and a
 * company that cares can upload an already-padded image.
 */
if (existsSync("assets/company-icon.png")) {
  copyFileSync("assets/company-icon.png", "assets/icon.png");
  copyFileSync("assets/company-icon.png", "assets/adaptive-icon.png");
  console.log("using the company's own icon");
} else {
  console.log("no company icon uploaded — using the platform's default. Upload one under Branding to replace it.");
}

/**
 * Every image app.json names must exist before prebuild runs. Expo's own failure for a missing one is an
 * ENOENT stack trace from deep inside @expo/image-utils, which says nothing about what to do — so this
 * checks first and says it plainly.
 */
const needed = ["assets/icon.png", "assets/adaptive-icon.png", "assets/splash.png", "assets/notification-icon.png"];
const missing = needed.filter((f) => !existsSync(f));
if (missing.length) {
  console.error(`\nMissing app images: ${missing.join(", ")}`);
  console.error("These are committed in mobile/assets/ and the build cannot run without them. If this is a fresh");
  console.error("clone, check they were not lost to a .gitignore rule covering *.png.\n");
  process.exit(1);
}

console.log(`branded ${name} · ${bundleId} · v${version} (${buildNumber}) → ${get("API_BASE")}`);

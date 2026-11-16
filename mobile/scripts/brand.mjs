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

// the company's own icon, when one was downloaded by the workflow
if (existsSync("assets/company-icon.png")) {
  copyFileSync("assets/company-icon.png", "assets/icon.png");
  console.log("using the company's icon");
}
console.log(`branded ${name} · ${bundleId} · v${version} (${buildNumber}) → ${get("API_BASE")}`);

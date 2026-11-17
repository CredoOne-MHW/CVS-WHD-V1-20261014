/**
 * Pause / Resume / Stop, the progress the bar is drawn from, and the store-compliance settings.
 *
 * None of this needs a database. What it checks is the contract between the three places that have to
 * agree — the workflow, the script that reports back, and the platform that draws the result — because
 * every mobile-build failure in this project so far has been those three disagreeing rather than any one
 * of them being wrong on its own.
 *
 *   npx tsx tests/build-controls.test.ts
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { createServer } from "http";

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const ok = (name: string, cond: boolean) => check(name, !!cond, true);

const wf = readFileSync(".github/workflows/build-mobile.yml", "utf8");

/* ── 1 · the workflow reports progress, and the platform can take it ───────────────────────────── */

const progressCalls = [...wf.matchAll(/report\.mjs building (\d+) ([^\n]+)/g)].map((m) => ({ pct: Number(m[1]), phase: m[2].trim() }));
ok("the workflow reports progress at several points", progressCalls.length >= 4);
ok("the percentages only ever go up", progressCalls.every((c, i) => i === 0 || c.pct >= progressCalls[i - 1].pct));
ok("every percentage is within 0–100", progressCalls.every((c) => c.pct >= 0 && c.pct <= 100));
ok("each one carries a sentence, not just a number", progressCalls.every((c) => c.phase.length > 3));
ok("the first one says it is waiting for a machine", /waiting for a build machine/i.test(progressCalls[0]?.phase || ""));

/* ── 2 · report.mjs turns those arguments into the fields the callback reads ───────────────────── */

async function reportSends() {
  return new Promise<any>((resolve, reject) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
        server.close();
        resolve(JSON.parse(body));
      });
    });
    /**
     * The child runs asynchronously on purpose.
     *
     * execFileSync blocks this process's event loop, so the server above would never get as far as
     * accepting the connection the child is making to it, and the two would wait for each other for ever.
     */
    server.listen(0, () => {
      const port = (server.address() as any).port;
      execFile(
        "node",
        [".github/scripts/report.mjs", "building", "55", "Compiling", "and", "bundling"],
        { env: { ...process.env, CALLBACK_URL: `http://127.0.0.1:${port}/cb`, BUILD_ID: "b1", MOBILE_BUILD_SECRET: "s", RUN_ID: "9", RUN_URL: "http://x" } },
        (err) => {
          if (err) reject(err);
        }
      );
    });
    setTimeout(() => reject(new Error("report.mjs never called back")), 15_000).unref();
  });
}

/* ── 3 · the store settings that decide whether an upload is accepted at all ───────────────────── */

function storeCompliance() {
  // Apple refuses a build made with an old Xcode. macos-14 carries Xcode 15; macos-15 carries Xcode 16.
  // the runs-on line only — "macos-14" also appears in the comment explaining why it is not used
  const runsOn = (wf.match(/^\s*runs-on:.*$/m) || [""])[0];
  ok("iOS builds run on a runner new enough for the App Store", /macos-15/.test(runsOn) && !/macos-14/.test(runsOn));

  const app = JSON.parse(readFileSync("mobile/app.json", "utf8"));
  const props = (app.expo.plugins || []).find((p: any) => Array.isArray(p) && p[0] === "expo-build-properties");
  ok("the Android API level is set explicitly rather than left at the Expo default", !!props);
  check("compile and target levels match", props?.[1]?.android?.compileSdkVersion, props?.[1]?.android?.targetSdkVersion);

  /**
   * The level must be one the installed Expo can actually compile against.
   *
   * v1.10.0 set this to 35 for Google Play and broke every Android build: Expo 51's own Kotlin source is
   * written against API 34, and in 35 Android annotated `PackageInfo.requestedPermissions` as nullable, so
   * expo-modules-core stopped compiling. The level Play wants and the level Expo supports are two different
   * things, and this is the one that decides whether anything builds at all.
   */
  const brand = readFileSync("mobile/scripts/brand.mjs", "utf8");
  const caps = /MAX_SDK_FOR_EXPO = \{([^}]*)\}/.exec(brand)?.[1] || "";
  const expoMajor = parseInt(String(JSON.parse(readFileSync("mobile/package.json", "utf8")).dependencies.expo).replace(/^\D*/, ""), 10);
  const cap = Number(new RegExp(`\\b${expoMajor}\\s*:\\s*(\\d+)`).exec(caps)?.[1] || 0);
  ok(`the app's Expo SDK (${expoMajor}) has a known ceiling`, cap > 0);
  ok(`…and the configured level (${props?.[1]?.android?.compileSdkVersion}) is within it (${cap})`, (props?.[1]?.android?.compileSdkVersion || 99) <= cap);
  ok("the build refuses a level above that ceiling rather than failing inside Expo", /::error::Android API level/.test(brand));

  // Without this every App Store upload stops and asks the same question by e-mail.
  check("the export-compliance answer is declared", app.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);

  // the level has to reach the build, or setting it here changes nothing
  ok("the workflow takes the API level as an input", /android_target_sdk:/.test(wf));
  ok("…and passes it to the branding step", /ANDROID_TARGET_SDK:/.test(wf));
  ok("…and the branding step reads it", /ANDROID_TARGET_SDK/.test(readFileSync("mobile/scripts/brand.mjs", "utf8")));
}

/* ── 4 · the version comparison the app's update bar uses ──────────────────────────────────────── */

/** Copied from mobile/src/components/UpdateBar.tsx — the one piece of it that can be wrong silently. */
function isNewer(theirs: string, mine: string) {
  const a = String(theirs).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(mine).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function versions() {
  // the one a string comparison gets wrong, and the reason this is not done with <
  check("1.0.0.16 is newer than 1.0.0.9", isNewer("1.0.0.16", "1.0.0.9"), true);
  check("1.0.0.9 is not newer than 1.0.0.16", isNewer("1.0.0.9", "1.0.0.16"), false);
  check("the same version is not newer than itself", isNewer("1.0.0.16", "1.0.0.16"), false);
  check("a bigger middle number wins", isNewer("1.1.0.1", "1.0.9.9"), true);
  check("a shorter version is handled", isNewer("1.1", "1.0.9"), true);
  check("rubbish does not claim to be newer", isNewer("", "1.0.0.1"), false);
}

/* ── 5 · a paused build must not be flipped back by the run it just cancelled ──────────────────── */

/** The guard from updateBuild, stated here so the reason for it survives. */
const keepsPaused = (current: string, incoming: string) => (current === "paused" && incoming !== "building" ? current : incoming);

function pausing() {
  check("a cancelled run arriving after Pause does not un-pause the row", keepsPaused("paused", "cancelled"), "paused");
  check("…nor does a failure from that same run", keepsPaused("paused", "failed"), "paused");
  check("a resumed build may go back to building", keepsPaused("paused", "building"), "building");
  check("an ordinary build is unaffected", keepsPaused("building", "ready"), "ready");
}

(async () => {
  const sent = await reportSends();
  check("the percentage is sent as a number", sent.progress, 55);
  check("the sentence is sent whole", sent.phase, "Compiling and bundling");
  check("the status still travels with it", sent.status, "building");
  check("the run is still identified", sent.run_id, "9");

  storeCompliance();
  versions();
  pausing();

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
})();

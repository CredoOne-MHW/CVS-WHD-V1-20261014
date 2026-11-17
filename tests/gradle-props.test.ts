/**
 * Writing the signing properties into android/gradle.properties.
 *
 * The first case below is the v1.11.0 build failure, reproduced: `expo prebuild` wrote a file ending
 * "android.extraMavenRepos=[]" with no trailing newline, the workflow appended with `>>`, and the first
 * property was glued onto the end of that line. Gradle then failed with "Could not get unknown property
 * 'MYAPP_UPLOAD_STORE_FILE'" seventy seconds in. Everything here is about never paying twenty minutes of
 * CI to find that out again.
 *
 *   npx tsx tests/gradle-props.test.ts
 */
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const ok = (name: string, cond: boolean) => check(name, !!cond, true);

const dir = mkdtempSync(join(tmpdir(), "gp-"));
const SCRIPT = ".github/scripts/gradle-props.mjs";

/** Runs the script over a file with the given starting contents, and parses the result as Gradle would. */
function run(start: string, pairs: string[]) {
  const file = join(dir, `p-${Math.random().toString(36).slice(2)}.properties`);
  writeFileSync(file, start);
  let failed = false;
  try {
    execFileSync("node", [SCRIPT, file, ...pairs], { stdio: "pipe" });
  } catch {
    failed = true;
  }
  const text = readFileSync(file, "utf8");
  const props = new Map<string, string>();
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0 && !/^\s*[#!]/.test(line)) props.set(line.slice(0, at).trim(), line.slice(at + 1));
  }
  return { text, props, failed };
}

const FOUR = ["MYAPP_UPLOAD_STORE_FILE=release.jks", "MYAPP_UPLOAD_KEY_ALIAS=cvskey", "MYAPP_UPLOAD_STORE_PASSWORD=s3cret", "MYAPP_UPLOAD_KEY_PASSWORD=s3cret"];

/* ── 1 · the failure this was written for ─────────────────────────────────────────────────────── */

// exactly what expo prebuild writes once expo-build-properties is installed: no trailing newline
const noNewline = "android.useAndroidX=true\nandroid.buildToolsVersion=35.0.0\nandroid.extraMavenRepos=[]";
const a = run(noNewline, FOUR);
check("the store file is found even with no trailing newline", a.props.get("MYAPP_UPLOAD_STORE_FILE"), "release.jks");
check("…and the line it would have been glued onto is untouched", a.props.get("android.extraMavenRepos"), "[]");
check("all four are set", FOUR.map((p) => a.props.get(p.split("=")[0])), ["release.jks", "cvskey", "s3cret", "s3cret"]);
ok("the file ends with a newline afterwards", a.text.endsWith("\n"));

// and the shape that used to work, so the fix did not break it
const b = run("android.useAndroidX=true\nandroid.useLegacyPackaging=false\n", FOUR);
check("a file that does end in a newline still works", b.props.get("MYAPP_UPLOAD_STORE_FILE"), "release.jks");
check("…and keeps what was already there", b.props.get("android.useLegacyPackaging"), "false");

/* ── 2 · running twice ────────────────────────────────────────────────────────────────────────── */

const file = join(dir, "twice.properties");
writeFileSync(file, noNewline);
execFileSync("node", [SCRIPT, file, ...FOUR], { stdio: "pipe" });
execFileSync("node", [SCRIPT, file, "MYAPP_UPLOAD_STORE_FILE=other.jks", ...FOUR.slice(1)], { stdio: "pipe" });
const twice = readFileSync(file, "utf8");
check("running again replaces rather than duplicates", (twice.match(/^MYAPP_UPLOAD_STORE_FILE=/gm) || []).length, 1);
ok("…with the newer value", /^MYAPP_UPLOAD_STORE_FILE=other\.jks$/m.test(twice));

/* ── 3 · awkward values ───────────────────────────────────────────────────────────────────────── */

const c = run(noNewline, ["MYAPP_UPLOAD_STORE_PASSWORD=a=b=c", "MYAPP_UPLOAD_STORE_FILE=release.jks"]);
check("a password containing = survives whole", c.props.get("MYAPP_UPLOAD_STORE_PASSWORD"), "a=b=c");

const d = run("android.useAndroidX=true\r\nandroid.extraMavenRepos=[]", FOUR);
ok("windows line endings leave no carriage return in a password", !(d.props.get("MYAPP_UPLOAD_KEY_PASSWORD") || "").includes("\r"));

const e = run("# a comment = not a property\nandroid.extraMavenRepos=[]", FOUR);
ok("a comment is left alone", e.text.includes("# a comment = not a property"));

const f = run("", FOUR);
check("an empty file is fine", f.props.get("MYAPP_UPLOAD_STORE_FILE"), "release.jks");
ok("…and gains no blank first line", !f.text.startsWith("\n"));

/* ── 4 · it refuses rather than half-doing the job ────────────────────────────────────────────── */

ok("a pair with no = is refused", run(noNewline, ["JUST_A_KEY"]).failed);

/* ── 5 · the Gradle side gives a readable error rather than a Groovy one ──────────────────────── */

const gradle = readFileSync(".github/scripts/android-signing-config.mjs", "utf8");
ok("the signing config reads the property defensively", gradle.includes("findProperty('MYAPP_UPLOAD_STORE_FILE')"));
ok("…and says what is wrong when it is missing", /GradleException/.test(gradle));
ok("no bare unguarded property is left in the emitted config", !/storeFile file\(MYAPP_UPLOAD_STORE_FILE\)/.test(gradle));

/* ── 6 · the workflow actually uses the script ────────────────────────────────────────────────── */

const wf = readFileSync(".github/workflows/build-mobile.yml", "utf8");
ok("the workflow writes the properties with the script", wf.includes("gradle-props.mjs"));
ok("…and no longer appends them with >>", !/>>\s*android\/gradle\.properties/.test(wf));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);

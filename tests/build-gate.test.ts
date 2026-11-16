/**
 * The build gate — what readyToBuild() lets through and what it stops.
 *
 * This exists because of a bug it would have caught: the set-up panel knew the platform keeps
 * MOBILE_BUILD_SECRET, startBuild() did not, so the screen said "ready" while every build was refused for a
 * variable that is deliberately empty. It reads no database and talks to nothing — run it anywhere:
 *
 *   npx tsx tests/build-gate.test.ts
 */
import { BUILD_REQUIREMENTS, SHAPE } from "../shared/mobile";

const env: Record<string, string> = {
  GITHUB_BUILD_REPO: "CredoOne-MHW/CVS-WHD-V1-20261014",
  GITHUB_BUILD_TOKEN: "ghp_xxxxxxxxxxxxxxxxxxxx",
  GITHUB_BUILD_WORKFLOW: "build-mobile.yml",
  MOBILE_BUILD_SECRET: "",            // deliberately empty: the platform keeps it
  S3_BUCKET: "cvs-lms",
  AWS_ACCESS_KEY_ID: "AKIAxxxx",
};
const get = (k: string) => (env[k] || "").trim();

function readyToBuild(held: Record<string, boolean> = {}) {
  const bad = BUILD_REQUIREMENTS.filter((r) => {
    if (r.where !== "platform") return false;
    const v = get(r.key);
    if (r.required && !v && !held[r.key]) return true;
    return !!(v && r.check && r.check(v));
  }).map((r) => r.key);
  return { ok: !bad.length, missing: bad };
}

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

// the bug: the panel knew, the build did not
check("without the held map, the build refuses", readyToBuild().missing, ["MOBILE_BUILD_SECRET"]);
check("with it, the build goes ahead", readyToBuild({ MOBILE_BUILD_SECRET: true }), { ok: true, missing: [] });

// v1.7.1 shape checks still bite
env.GITHUB_BUILD_REPO = "https://github.com/CredoOne-MHW/CVS-WHD-V1-20261014.git";
check("a git URL is still refused", readyToBuild({ MOBILE_BUILD_SECRET: true }).missing, ["GITHUB_BUILD_REPO"]);
check("and names the short form", /CredoOne-MHW\/CVS-WHD-V1-20261014/.test(SHAPE.repo(env.GITHUB_BUILD_REPO) || ""), true);
env.GITHUB_BUILD_REPO = "CredoOne-MHW/CVS-WHD-V1-20261014";

// from v1.8.4 the workflow is a constant, so a value copied from the restaurant platform cannot
// point this one at a desktop installer workflow that does not exist here
env.GITHUB_BUILD_WORKFLOW = "build-desktop.yml";
check("another project's workflow cannot break the gate", readyToBuild({ MOBILE_BUILD_SECRET: true }).ok, true);
check("the workflow is not a requirement any more", BUILD_REQUIREMENTS.some((r) => r.key === "GITHUB_BUILD_WORKFLOW"), false);
delete env.GITHUB_BUILD_WORKFLOW;
check("and the gate is happy without it", readyToBuild({ MOBILE_BUILD_SECRET: true }).ok, true);

// an environment-set secret must still win
env.MOBILE_BUILD_SECRET = "0123456789abcdef0123456789abcdef";
check("an env secret works with no held map", readyToBuild(), { ok: true, missing: [] });
env.MOBILE_BUILD_SECRET = "short";
check("a too-short secret is refused", readyToBuild().missing, ["MOBILE_BUILD_SECRET"]);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);

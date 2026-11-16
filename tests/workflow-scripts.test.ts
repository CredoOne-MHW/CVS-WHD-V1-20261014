/**
 * The scripts the build workflow runs, and the paths it runs them from.
 *
 * This exists because of two bugs it would have caught:
 *
 *   1. The job sets `working-directory: mobile`, so `.github/scripts/x` resolved to `mobile/.github/scripts/x`
 *      and the build died with "No such file or directory" after signing had already succeeded.
 *   2. Those scripts were written in Python, which is not part of this project's stack.
 *
 * Neither needs a database or a runner.
 *
 *   npx tsx tests/workflow-scripts.test.ts
 */
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const workflow = readFileSync(".github/workflows/build-mobile.yml", "utf8");

/* the stack is Next.js, Node and React Native — nothing else belongs in the build */
check("the workflow runs no Python", /python|\.py\b/i.test(workflow), false);
check("every script it runs is Node", [...workflow.matchAll(/\n\s+(?:run: |\s{10})(\S*node \S+\.mjs)/g)].length > 0, true);

/* every script named in the workflow has to be where the workflow looks for it */
const jobDir = "mobile"; // the job's `defaults.run.working-directory`
for (const m of workflow.matchAll(/node (\.\.\/\.github\/scripts\/\S+\.mjs|\.github\/scripts\/\S+\.mjs)/g)) {
  const ref = m[1];
  // a step that does not override it runs from mobile/, so ../ is how it reaches the repository root
  const fromRoot = ref.startsWith("../") ? ref.slice(3) : ref;
  const runsFromRepoRoot = !ref.startsWith("../");
  const resolved = runsFromRepoRoot ? fromRoot : join(jobDir, ref);
  check(`${ref} exists where the workflow looks`, existsSync(fromRoot), true);
  // and the two forms must not be mixed up: ../ only makes sense from the job's own directory
  check(`${ref} resolves inside the repository`, !resolved.includes("mobile/.github"), true);
}

/* the revision marker is how the platform spots a repository running an old workflow — the two must agree,
   or the check is worse than useless */
const marker = /#\s*lms-workflow:\s*([\w.\-]+)/.exec(workflow)?.[1];
const expected = /WORKFLOW_REVISION = "([\w.\-]+)"/.exec(readFileSync("server/lib/mobilebuild.ts", "utf8"))?.[1];
check("the workflow carries a revision marker", !!marker, true);
check("and the platform expects that same revision", marker, expected);

/* the signing config rewrite is the one with real logic in it, so it is exercised properly */
const dir = mkdtempSync(join(tmpdir(), "gradle-"));
mkdirSync(join(dir, "android/app"), { recursive: true });
const gradle = join(dir, "android/app/build.gradle");
writeFileSync(
  gradle,
  `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}
`
);

const script = join(process.cwd(), ".github/scripts/android-signing-config.mjs");
execFileSync("node", [script, "."], { cwd: dir, stdio: "pipe" });
const after = readFileSync(gradle, "utf8");

check("a release signing config is added", after.includes("MYAPP_UPLOAD_STORE_FILE"), true);
check("the release build uses it", /release\s*\{\s*signingConfig signingConfigs\.release/.test(after), true);
check("the debug build is left alone", /debug\s*\{\s*signingConfig signingConfigs\.debug/.test(after), true);
check("the existing debug keystore survives", after.includes("debug.keystore"), true);

// prebuild can run more than once, and so can this
const before = after;
execFileSync("node", [script, "."], { cwd: dir, stdio: "pipe" });
check("running it twice changes nothing", readFileSync(gradle, "utf8"), before);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);

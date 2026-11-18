/**
 * Everything that must pass before a release, in one command.
 *
 * This exists because the same classes of bug kept coming back, and "I'll remember to check" is not a
 * process. It runs the checks, then prints REGRESSIONS.md with a result against each automated line — so
 * the question "did we re-check the things that broke before?" has an answer on screen rather than in
 * somebody's memory.
 *
 * It fails loudly and stops at the first failure: a release is not partly ready.
 *
 *   npm run preflight
 */
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const OFF = "\u001b[0m";

/**
 * What `npm test` covers is read from package.json rather than listed here.
 *
 * It was a hand-written list, and it drifted the first time a test was added: the new checklist rows
 * reported "no check ran" while the test itself was passing. A list that has to be kept in step by hand
 * is a list that will be wrong — so this asks the thing that actually runs.
 */
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const testScripts = Object.keys(pkg.scripts || {}).filter((s) => s.startsWith("test:"));

const STEPS = [
  { name: "Platform typecheck", cmd: "npx tsc --noEmit", covers: [] },
  { name: "App typecheck", cmd: "cd mobile && npx tsc --noEmit", covers: [] },
  { name: "Test suite", cmd: "npm test", covers: testScripts },
  { name: "Production build", cmd: "npm run build", covers: [] },
  { name: "App bundle (as Gradle does it)", cmd: "npm run verify:bundle", covers: ["verify:bundle"] },
];

/** A test that exists but is not in the `npm test` chain would never run. Say so rather than imply it did. */
const chain = pkg.scripts?.test || "";
const orphans = testScripts.filter((s) => !chain.includes(s));

const passed = new Set();
let failedAt = null;

console.log(`\n${BOLD}Preflight${OFF} ${DIM}— everything that must pass before a release${OFF}\n`);

for (const step of STEPS) {
  process.stdout.write(`  ${step.name.padEnd(34)}`);
  const started = Date.now();
  try {
    execSync(step.cmd, { stdio: "pipe", encoding: "utf8" });
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${GREEN}passed${OFF} ${DIM}${secs}s${OFF}`);
    step.covers.forEach((c) => passed.add(c));
  } catch (e) {
    console.log(`${RED}FAILED${OFF}`);
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    console.log(`\n${out.split("\n").slice(-40).join("\n")}\n`);
    failedAt = step.name;
    break;
  }
}

/**
 * The checklist itself.
 *
 * Parsed out of REGRESSIONS.md rather than duplicated here, so the document people read and the thing that
 * runs cannot drift apart. A row whose check has not run is reported as such — not quietly as a pass.
 */
if (existsSync("REGRESSIONS.md")) {
  const rows = [...readFileSync("REGRESSIONS.md", "utf8").matchAll(/^\|\s*(\d+)\s*\|([^|]+)\|[^|]*\|[^|]*\|\s*`?([^|`]+)`?\s*\|/gm)].map((m) => ({
    n: m[1],
    what: m[2].trim(),
    check: m[3].trim(),
  }));

  const auto = rows.filter((r) => r.check !== "manual");
  const manual = rows.filter((r) => r.check === "manual");

  console.log(`\n${BOLD}Regression checklist${OFF} ${DIM}(REGRESSIONS.md)${OFF}\n`);
  for (const r of auto) {
    const state = failedAt ? `${YELLOW}not run${OFF}` : passed.has(r.check) ? `${GREEN}covered${OFF}` : `${YELLOW}no check ran${OFF}`;
    console.log(`  ${String(r.n).padStart(2)}. ${r.what.slice(0, 68).padEnd(70)} ${state}  ${DIM}${r.check}${OFF}`);
  }

  if (manual.length) {
    console.log(`\n${BOLD}Confirm these by hand${OFF} ${DIM}— no automated guard yet${OFF}\n`);
    for (const r of manual) console.log(`  ${String(r.n).padStart(2)}. ${r.what}`);
  }
}

if (orphans.length) {
  console.log(`
${YELLOW}${BOLD}Not in the test chain:${OFF} ${orphans.join(", ")} — add them to the "test" script or they never run.`);
}

if (failedAt) {
  console.log(`\n${RED}${BOLD}Not ready.${OFF} ${failedAt} failed — fix it and run this again.\n`);
  process.exit(1);
}

console.log(`\n${GREEN}${BOLD}All checks passed.${OFF}`);
console.log(`${DIM}Remember: mobile/ and .github/ go to the build repository, the rest to Vercel.${OFF}\n`);

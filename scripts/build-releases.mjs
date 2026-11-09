// Release notes: compiles content/releases/*.md into shared/releases.generated.json on every build (prebuild),
// so /release always lists what the deployed version actually contains. Add a file per version; the newest is
// the running version and must match package.json.
//
// Versioning: vX.Y.Z — bug fix bumps Z, a minor change bumps Y, a major change bumps X.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "content", "releases");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cmp = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
};

const releases = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
  const raw = readFileSync(join(dir, f), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`content/releases/${f}: missing front matter (---)`);
  const meta = Object.fromEntries(
    m[1]
      .split("\n")
      .map((l) => l.match(/^(\w+):\s*(.*)$/))
      .filter(Boolean)
      .map((x) => [x[1], x[2].trim()])
  );
  if (!/^\d+\.\d+\.\d+$/.test(meta.version || "")) throw new Error(`content/releases/${f}: version must be x.y.z`);
  releases.push({ version: meta.version, date: meta.date || "", title: meta.title || "", kind: meta.kind || "minor", md: m[2].trim(), html: marked.parse(m[2], { gfm: true, async: false }) });
}
releases.sort((a, b) => cmp(a.version, b.version));
if (!releases.length) throw new Error("No release notes in content/releases");
if (releases[0].version !== pkg.version) throw new Error(`package.json is ${pkg.version} but the newest release note is ${releases[0].version} — keep them in step`);

writeFileSync(join(root, "shared", "releases.generated.json"), JSON.stringify({ current: pkg.version, builtAt: new Date().toISOString(), commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null, releases }, null, 1));
console.log(`Release notes: v${pkg.version} + ${releases.length - 1} earlier → shared/releases.generated.json`);

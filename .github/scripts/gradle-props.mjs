/**
 * Sets properties in android/gradle.properties, safely.
 *
 * This exists because of the bug it was written to fix. The workflow used to append with a shell heredoc:
 *
 *     { echo "MYAPP_UPLOAD_STORE_FILE=release.jks"; … } >> android/gradle.properties
 *
 * which is correct only while the file happens to end in a newline. `expo prebuild` writes that file, and
 * what it ends with depends on which config plugins are installed — adding `expo-build-properties` made the
 * last line `android.extraMavenRepos=[]` with no trailing newline, so the first property was glued onto the
 * end of it:
 *
 *     android.extraMavenRepos=[]MYAPP_UPLOAD_STORE_FILE=release.jks
 *
 * Gradle then saw `android.extraMavenRepos` with a strange value and no `MYAPP_UPLOAD_STORE_FILE` at all,
 * and failed seventy seconds into the build with "Could not get unknown property". The other three
 * properties were on their own lines and were fine, which is why only the first was ever named.
 *
 * So: no appending. The file is read, parsed, updated and written back — which also makes it idempotent
 * (running twice does not duplicate a key) and lets it verify afterwards that Gradle will actually find
 * what was asked for.
 *
 *   node .github/scripts/gradle-props.mjs <gradle.properties path> KEY=value [KEY=value …]
 *
 * Values are never printed: these carry keystore passwords.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";

const [file, ...pairs] = process.argv.slice(2);

if (!file || !pairs.length) {
  console.log("::error::gradle-props.mjs needs a file and at least one KEY=value");
  process.exit(1);
}

/** Only the part before the first "=" is the key; a value may contain "=" and often does. */
const wanted = new Map();
for (const p of pairs) {
  const at = p.indexOf("=");
  if (at < 1) {
    console.log(`::error::"${p.split("=")[0]}" is not a KEY=value pair`);
    process.exit(1);
  }
  wanted.set(p.slice(0, at), p.slice(at + 1));
}

const original = existsSync(file) ? readFileSync(file, "utf8") : "";
// \r\n would otherwise leave a stray carriage return inside a password
const lines = original.replace(/\r\n/g, "\n").split("\n");

/** Drop any existing line setting one of these keys, so re-running replaces rather than duplicates. */
const kept = lines.filter((line) => {
  const at = line.indexOf("=");
  if (at < 1 || /^\s*[#!]/.test(line)) return true; // a comment or not a property
  return !wanted.has(line.slice(0, at).trim());
});

while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();

const out = [...kept, ...[...wanted].map(([k, v]) => `${k}=${v}`), ""].join("\n");
writeFileSync(file, out);

/**
 * Read it back and check Gradle will find every key.
 *
 * The point of this script is that a missing property costs a whole build to discover, so the check that
 * it is really there belongs here — a second of work against twenty minutes of Gradle.
 */
const check = new Map();
for (const line of readFileSync(file, "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !/^\s*[#!]/.test(line)) check.set(line.slice(0, at).trim(), line.slice(at + 1));
}
const missing = [...wanted.keys()].filter((k) => !check.has(k));
if (missing.length) {
  console.log(`::error::${file} still does not define: ${missing.join(", ")}`);
  process.exit(1);
}
for (const [k, v] of wanted) {
  if (check.get(k) !== v) {
    console.log(`::error::${k} did not come back as it was written — check ${file} for stray characters.`);
    process.exit(1);
  }
}
console.log(`Set in ${file}: ${[...wanted.keys()].join(", ")}`);

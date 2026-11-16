/**
 * Teaches android/app/build.gradle to sign the release build with the keystore the workflow just wrote.
 *
 * React Native ships a build.gradle whose release build is signed with the debug key — fine for a quick run
 * on your own machine, useless for anything a phone will keep, because a debug-signed app cannot be updated
 * by a properly signed one. This rewrites two things, once, and does nothing if it has already been done:
 *
 *   • a `release` entry under signingConfigs, reading the four MYAPP_UPLOAD_* values from gradle.properties
 *   • the release buildType, so it uses `signingConfigs.release` instead of `signingConfigs.debug`
 *
 * It lives in a file rather than inline in the workflow on purpose: an embedded heredoc has to stay indented
 * past the YAML block it sits in, and the moment a line de-indents the workflow stops being valid YAML —
 * which is exactly what happened before v1.7.1.
 *
 * Run from the repository root: node .github/scripts/android-signing-config.mjs <project dir, default "mobile">
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const projectDir = process.argv[2] || "mobile";
const file = join(projectDir, "android/app/build.gradle");

const RELEASE_CONFIG = `signingConfigs {
        release {
            storeFile file(MYAPP_UPLOAD_STORE_FILE)
            storePassword MYAPP_UPLOAD_STORE_PASSWORD
            keyAlias MYAPP_UPLOAD_KEY_ALIAS
            keyPassword MYAPP_UPLOAD_KEY_PASSWORD
        }`;

if (!existsSync(file)) {
  console.log(`::error::${file} is missing — did \`expo prebuild\` run?`);
  process.exit(1);
}

let text = readFileSync(file, "utf8");

if (text.includes("MYAPP_UPLOAD_STORE_FILE")) {
  console.log("The release signing config is already there.");
  process.exit(0);
}

if (!text.includes("signingConfigs {")) {
  console.log("::error::No signingConfigs block in build.gradle, so the release key cannot be wired in.");
  process.exit(1);
}

text = text.replace("signingConfigs {", RELEASE_CONFIG);

// point the release buildType at the release key instead of the debug one
const before = text;
text = text.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig signingConfigs\.)debug/, "$1release");
if (text === before) console.log("::warning::Could not find the release buildType's signingConfig line — check build.gradle by hand.");

writeFileSync(file, text);
console.log("Release signing config added.");

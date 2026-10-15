// Fails the build if any useEffect/useLayoutEffect uses an expression body, e.g. useEffect(() => el.scrollIntoView(), []).
// An expression body returns its value; React calls a returned value as the cleanup. Newer Chrome returns a Promise
// from scrollIntoView, which crashed the AI chat windows with "n is not a function".
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
const bad = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f)) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (/use(Layout)?Effect\(\s*\(\)\s*=>\s*[^{\s]/.test(line)) bad.push(`${p}:${i + 1}: ${line.trim()}`);
      });
    }
  }
};
walk("src");
if (bad.length) {
  console.error("useEffect must use a block body — useEffect(() => { ... }):\n" + bad.join("\n"));
  process.exit(1);
}
console.log("✓ effects check passed");

// Runs before every build (npm "prebuild"). Keeps the WhatsApp Webhook event list in step with the code:
// every event registered in shared/events.ts must be fired somewhere in server/ (unless marked manual: true).
// Firing an unregistered event is already a TypeScript error (fireEvent only accepts registered keys).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const reg = readFileSync(join(root, "shared/events.ts"), "utf8");
const entries = [...reg.matchAll(/\{\s*key:\s*"([a-z0-9_]+)"([^}]*)\}/g)].map((m) => ({ key: m[1], manual: /manual:\s*true/.test(m[2]) }));
if (!entries.length) {
  console.error("check-events: no events found in shared/events.ts");
  process.exit(1);
}
const dupes = entries.map((e) => e.key).filter((k, i, a) => a.indexOf(k) !== i);
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
};
walk(join(root, "server"));
const code = files.map((f) => readFileSync(f, "utf8")).join("\n");
const unused = entries.filter((e) => !e.manual && !code.includes(`"${e.key}"`)).map((e) => e.key);
if (dupes.length || unused.length) {
  if (dupes.length) console.error(`check-events: duplicate event keys in shared/events.ts: ${dupes.join(", ")}`);
  if (unused.length) console.error(`check-events: registered but never fired (remove from shared/events.ts or fire them): ${unused.join(", ")}`);
  process.exit(1);
}
console.log(`✓ WhatsApp events: ${entries.length} registered, all fired`);

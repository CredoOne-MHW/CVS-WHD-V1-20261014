/**
 * Every router mounted under a path parameter must inherit it.
 *
 * This exists because of a bug it would have caught on the day it was written. `mobileRoutes` and
 * `dpdpRoutes` are mounted at `/companies/:id`, and an Express sub-router does NOT inherit its mount path's
 * parameters unless created with `{ mergeParams: true }`. Without it `req.params.id` is undefined, the
 * company lookup matches nothing, and every request answers "Company not found".
 *
 * The Mobile App tab never worked because of this — it first appeared as a spinner that never stopped, then
 * (once errors were surfaced) as a 404 nobody could explain. The DPDP tab had it too and nobody had opened
 * it yet.
 *
 * Two checks: the Express behaviour itself, so the reason is on the record, and a scan of the routes so a
 * new router mounted this way cannot repeat it.
 *
 *   npx tsx tests/router-params.test.ts
 */
import express from "express";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

/* 1 — the behaviour this is all about, stated once so nobody has to rediscover it */
async function expressBehaviour() {
  return new Promise<void>((resolve) => {
  const app = express();
  const plain = express.Router();
  plain.get("/x", (req, res) => res.json({ id: (req.params as any).id ?? null }));
  app.use("/a/:id", plain);
  const merged = express.Router({ mergeParams: true });
  merged.get("/x", (req, res) => res.json({ id: (req.params as any).id ?? null }));
  app.use("/b/:id", merged);

  const server = app.listen(0, async () => {
    const port = (server.address() as any).port;
    const a = await (await fetch(`http://127.0.0.1:${port}/a/abc/x`)).json();
    const b = await (await fetch(`http://127.0.0.1:${port}/b/abc/x`)).json();
    check("a plain sub-router does NOT see its mount parameter", a.id, null);
    check("mergeParams makes it see it", b.id, "abc");
    server.close(() => resolve());
  });
  });
}

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/* 2 — and no router in this project is mounted that way without it */
function scanRoutes() {
const files = walk("server/routes");
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/** Routers mounted on a path containing ":param", and the factory or variable each one came from. */
const mountedWithParam: { where: string; what: string }[] = [];
for (const [file, src] of sources) {
  for (const m of src.matchAll(/\.use\(\s*["'][^"']*:[^"']*["']\s*,\s*(\w+)/g)) {
    mountedWithParam.push({ where: file, what: m[1] });
  }
}

check("there is at least one such mount to check", mountedWithParam.length > 0, true);

for (const { where, what } of mountedWithParam) {
  // the factory may live in another file, so look everywhere for its definition
  let declared = false;
  let found = false;
  for (const [, src] of sources) {
    const fn = new RegExp(`(?:export\\s+)?(?:function\\s+${what}|const\\s+${what}\\s*=)[\\s\\S]{0,1200}?Router\\((\\{[^)]*\\})?\\)`);
    const hit = fn.exec(src);
    if (hit) {
      found = true;
      declared = !!hit[1] && /mergeParams\s*:\s*true/.test(hit[1]);
      break;
    }
  }
  if (!found) {
    console.log(`SKIP  ${what} (mounted in ${where}) — could not find where its Router is created`);
    continue;
  }
  check(`${what}, mounted under a parameter in ${where}, sets mergeParams`, declared, true);
}

}

expressBehaviour()
  .then(scanRoutes)
  .then(() => {
    console.log(fails ? `\n${fails} FAILED` : "\nall passed");
    process.exit(fails ? 1 : 0);
  });

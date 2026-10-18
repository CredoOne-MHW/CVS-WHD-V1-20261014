// Latency check against the budgets: common read APIs p95 < 300 ms, common write APIs p95 < 500 ms.
//   BASE_URL=https://<company>.mhw.credovation.tech EMAIL=… PASSWORD=… node scripts/perf-check.mjs [--runs 30] [--writes]
// Signs in as a company user, warms up, then times each endpoint sequentially (one user, like a real session).
// --writes also times lead create + update: it creates ONE lead named "Perf check" (campaign perf-check) and edits it.
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 30;
const doWrites = process.argv.includes("--writes");
const READ_BUDGET = 300, WRITE_BUDGET = 500;
let cookie = "";
async function call(method, path, body) {
  const t = performance.now();
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", origin: BASE, cookie }, body: body ? JSON.stringify(body) : undefined });
  const ms = performance.now() - t;
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0]).join("; ");
  const json = await r.json().catch(() => null);
  return { ms, status: r.status, json };
}
const p = (a, q) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(a.length * q) - 1)];
const login = await call("POST", "/api/auth/login", { email: process.env.EMAIL, password: process.env.PASSWORD });
if (login.status !== 200) {
  console.error("login failed", login.status, login.json);
  process.exit(2);
}
if (process.env.COMPANY_ID) await call("POST", `/api/auth/impersonate/${process.env.COMPANY_ID}`); // Super Admin testing a company
const reads = ["/api/auth/me", "/api/co/dashboard/overview?days=30", "/api/co/leads?page=1", "/api/co/leads/meta", "/api/co/clients?page=1", "/api/co/clients-board", "/api/co/clients-tickets?page=1", "/api/co/clients-payments?kind=recurring", "/api/co/wa-logs?page=1", "/api/co/ai-agents", "/api/co/subscription"];
const rows = [];
let failed = false;
for (const path of reads) {
  await call("GET", path); // warm-up
  const t = [];
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const r = await call("GET", path);
    status = r.status;
    t.push(r.ms);
  }
  const p95 = p(t, 0.95);
  const ok = status < 400 && p95 <= READ_BUDGET;
  failed ||= !ok;
  rows.push({ kind: "read", path, status, p50: p(t, 0.5), p95, ok });
}
if (doWrites) {
  const c = await call("POST", "/api/co/leads", { name: "Perf check", phone: "9" + String(Date.now()).slice(-9), campaign: "perf-check", source: "manual" });
  const id = c.json?._id || c.json?.lead?._id;
  const t1 = [c.ms];
  const t2 = [];
  for (let i = 0; i < runs && id; i++) t2.push((await call("PUT", `/api/co/leads/${id}`, { comments: `perf ${i}` })).ms);
  for (const [path, t] of [["POST /api/co/leads", t1], ["PUT /api/co/leads/:id", t2]]) {
    if (!t.length) continue;
    const p95 = p(t, 0.95);
    failed ||= p95 > WRITE_BUDGET;
    rows.push({ kind: "write", path, status: c.status, p50: p(t, 0.5), p95, ok: p95 <= WRITE_BUDGET });
  }
}
console.log(`\n${BASE} · ${runs} runs per endpoint\n`);
for (const r of rows) console.log(`${r.ok ? "✓" : "✗"} ${r.kind.padEnd(5)} ${r.path.padEnd(42)} p50 ${r.p50.toFixed(0).padStart(4)} ms   p95 ${r.p95.toFixed(0).padStart(4)} ms   (budget ${r.kind === "read" ? READ_BUDGET : WRITE_BUDGET})${r.status >= 400 ? `  HTTP ${r.status}` : ""}`);
process.exit(failed ? 1 : 0);

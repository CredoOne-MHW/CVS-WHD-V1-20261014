// Load test with k6 (https://k6.io):  k6 run -e BASE=https://mhw.credovation.tech -e COOKIE="lms_token=..." tests/load/k6-smoke.js
// Ramps to 2,000 virtual users. Raise stages gradually and watch Vercel + Atlas metrics before any big launch.
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 200 },
    { duration: "3m", target: 2000 },
    { duration: "1m", target: 0 },
  ],
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<800"] },
};

const BASE = __ENV.BASE || "http://localhost:3000";
const H = __ENV.COOKIE ? { headers: { Cookie: __ENV.COOKIE } } : {};

export default function () {
  check(http.get(`${BASE}/api/public/branding`), { "branding 200": (r) => r.status === 200 });
  if (__ENV.COOKIE) {
    check(http.get(`${BASE}/api/auth/me`, H), { "me 200": (r) => r.status === 200 });
    check(http.get(`${BASE}/api/co/leads?limit=25`, H), { "leads 200": (r) => r.status === 200 });
  }
  sleep(1);
}

/**
 * Tells the platform where a build has got to.
 *
 * Every message is signed with MOBILE_BUILD_SECRET, which the platform checks — so only a build started by
 * the platform can report a result. Never fails the job on its own: a build that finished is still a build.
 */
import { createHmac } from "crypto";

const status = process.argv[2] || "building";
const body = JSON.stringify({
  build_id: process.env.BUILD_ID,
  status,
  run_id: process.env.RUN_ID,
  run_url: process.env.RUN_URL,
  file_key: process.env.FILE_KEY || undefined,
  file_name: process.env.FILE_NAME || undefined,
  file_size: process.env.FILE_SIZE ? Number(process.env.FILE_SIZE) : undefined,
  sha256: process.env.SHA256 || undefined,
  // only a store build has these: what happened when the artefact was sent to Google or Apple
  target: process.env.TARGET || undefined,
  store_note: process.env.STORE_NOTE || undefined,
  error: status === "failed" ? process.env.ERROR || "The build failed" : undefined,
});
const signature = `sha256=${createHmac("sha256", process.env.MOBILE_BUILD_SECRET || "dev").update(body).digest("hex")}`;

try {
  const res = await fetch(process.env.CALLBACK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Build-Signature": signature },
    body,
  });
  console.log(`reported ${status}: ${res.status} ${(await res.text()).slice(0, 200)}`);
} catch (e) {
  console.log(`could not report ${status}: ${e.message}`);
}

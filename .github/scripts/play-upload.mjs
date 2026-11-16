/**
 * Sends a finished Android App Bundle to Google Play, onto the Internal testing track.
 *
 * It talks to Google's own Publishing API over plain HTTPS, with a service-account key — no SDK, no
 * dependency, nothing else that sees the key or the bundle. The service-account flow is a signed JWT
 * exchanged for an access token, and Node's crypto signs it natively.
 *
 * The Internal track is deliberate: it puts the build in front of your testers within minutes and never in
 * front of the public. Promoting it to Closed, Open or Production stays a decision somebody makes in the
 * Play Console.
 *
 * This never exits non-zero on a refusal from Google. The bundle is already on S3 by the time this runs, so
 * a failure here means "upload it by hand", not "build it again".
 *
 *   PLAY_PACKAGE   the application id, which must already exist in the Play Console
 *   PLAY_AAB       path to the .aab
 *   PLAY_SA_JSON   path to the service-account key file
 */
import { createSign } from "crypto";
import { existsSync, readFileSync, appendFileSync } from "fs";

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";

const pkg = (process.env.PLAY_PACKAGE || "").trim();
const aab = (process.env.PLAY_AAB || "").trim();
const keyFile = (process.env.PLAY_SA_JSON || "/tmp/play.json").trim();

/** Writes the one-line summary the workflow passes on to the platform, so the build row can show it. */
const note = (text) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `note=${text}\n`);
  console.log(text);
};

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The service-account dance: sign a JWT with the key, swap it for an access token. */
async function accessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(creds.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google refused the service account: ${json.error_description || json.error || res.status}`);
  return json.access_token;
}

async function call(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json?.error?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function main() {
  if (!pkg || !aab || !existsSync(aab) || !existsSync(keyFile)) {
    note(`kept on S3 — nothing to upload (package=${pkg || "?"}, bundle=${aab || "?"})`);
    return;
  }

  let creds;
  try {
    creds = JSON.parse(readFileSync(keyFile, "utf8"));
  } catch {
    note("kept on S3 — GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON");
    return;
  }

  try {
    const token = await accessToken(creds);
    const { id: editId } = await call(token, `${API}/${encodeURIComponent(pkg)}/edits`, { method: "POST" });

    const bundle = await call(token, `${UPLOAD}/${encodeURIComponent(pkg)}/edits/${editId}/bundles?uploadType=media`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: readFileSync(aab),
    });

    await call(token, `${API}/${encodeURIComponent(pkg)}/edits/${editId}/tracks/internal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releases: [{ versionCodes: [String(bundle.versionCode)], status: "completed" }] }),
    });

    await call(token, `${API}/${encodeURIComponent(pkg)}/edits/${editId}:commit`, { method: "POST" });
    note(`uploaded to the Internal testing track (version code ${bundle.versionCode})`);
  } catch (e) {
    // every refusal is reported and none is fatal — the .aab is already stored
    let hint = "";
    const msg = String(e?.message || e);
    if (e?.status === 404 || /not found|packageName/i.test(msg))
      hint = ` Create ${pkg} in the Play Console and upload one build there by hand first — Google will not accept an unknown application id over the API.`;
    else if (e?.status === 403 || /permission/i.test(msg))
      hint = " Invite the service account in Play Console → Users and permissions, with Release to testing tracks.";
    console.log(`::warning::Google Play refused the upload: ${msg}${hint}`);
    note(`Google Play refused it — the .aab is on S3. ${msg}`.slice(0, 280));
  }
}

main();

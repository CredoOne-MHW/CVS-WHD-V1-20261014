/**
 * Writes the two shared secrets into the build repository, so nobody has to paste them.
 *
 * GitHub will not take a secret in the clear even over HTTPS: it publishes a public key per repository and
 * expects the value sealed to it (libsodium's sealed box — an ephemeral key pair, so the same value sealed
 * twice looks different and nothing but the repository can open it).
 *
 * This needs the build token to carry **Secrets: write** as well as Actions. Plenty of tokens do not, so a
 * refusal here is reported plainly and the panel falls back to showing the values to copy — the manual route
 * never stops working.
 */
import _sodium from "libsodium-wrappers";
import { buildRepo } from "./mobilebuild";

const env = (k: string) => (process.env[k] || "").trim();
const API = "https://api.github.com";

function headers() {
  const token = env("GITHUB_BUILD_TOKEN");
  if (!token) throw new Error("GITHUB_BUILD_TOKEN is not set, so the platform cannot reach the repository.");
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}

/** The repository's own public key, which every secret must be sealed to. */
async function publicKey(repo: string) {
  const res = await fetch(`${API}/repos/${repo}/actions/secrets/public-key`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (res.status === 403) throw new Error("The token may not read this repository's secrets. Give it the Secrets: read and write permission, or set the secrets by hand.");
  if (res.status === 404) throw new Error(`GitHub does not recognise ${repo}, or the token cannot see it. Check GITHUB_BUILD_REPO is owner/repo.`);
  if (!res.ok) throw new Error(`GitHub refused (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { key_id: string; key: string };
}

async function putSecret(repo: string, name: string, value: string, pk: { key_id: string; key: string }) {
  await _sodium.ready;
  const sodium = _sodium;
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL));
  const res = await fetch(`${API}/repos/${repo}/actions/secrets/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: pk.key_id }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 403) throw new Error("The token may not write this repository's secrets. Give it Secrets: read and write, or set them by hand.");
  if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error(`GitHub refused ${name} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.status === 201 ? "created" : "updated";
}

/**
 * Sets each named secret in the build repository. Never throws for one secret failing — every one is
 * reported on its own, because "two of three worked" is the thing you need to know.
 */
export async function pushSecrets(values: Record<string, string>) {
  const repo = buildRepo();
  if (!repo) throw new Error("GITHUB_BUILD_REPO is not set.");
  const pk = await publicKey(repo);
  const results: { name: string; ok: boolean; message: string }[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!value) {
      results.push({ name, ok: false, message: "nothing to write — the platform has no value for this yet" });
      continue;
    }
    try {
      results.push({ name, ok: true, message: await putSecret(repo, name, value, pk) });
    } catch (e: any) {
      results.push({ name, ok: false, message: e?.message || String(e) });
    }
  }
  return { repo, results };
}

/** Which of the secrets the repository already holds. GitHub never returns a value, only the names. */
export async function listSecretNames() {
  const repo = buildRepo();
  if (!repo) return [];
  try {
    const res = await fetch(`${API}/repos/${repo}/actions/secrets?per_page=100`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json.secrets || []).map((s: any) => s.name as string);
  } catch {
    return []; // not being able to look is not an error worth showing — the build checks them anyway
  }
}

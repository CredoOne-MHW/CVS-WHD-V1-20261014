/**
 * The Android signing key each company's app is signed with.
 *
 * Android refuses an update signed with a different key than the installed app ("package conflicts with an
 * existing package"), so an app needs ONE permanent key for its whole life. The platform therefore makes one
 * key per company, keeps it, and gives it to every build of that company's app — which is what lets an update
 * install over the old app instead of needing an uninstall first.
 *
 * How it is kept:
 *   • the keystore and its passwords are encrypted with AES-256-GCM before they are written to the database,
 *     under MOBILE_SIGNING_SECRET — the database alone is not enough to sign anything;
 *   • they are never put into a workflow input, because those are readable in the run's own log. The build
 *     asks for them over the authenticated callback channel instead, uses them, and deletes the file;
 *   • nothing here is ever returned to a browser. The screens only ever see the fingerprint.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { MobileSigningKey, MobileBuild } from "../models";

const run = promisify(execFile);
const env = (k: string) => (process.env[k] || "").trim();

/** The key everything here is encrypted with. Derived once, so the setting can be a passphrase. */
function secret() {
  const raw = env("MOBILE_SIGNING_SECRET");
  if (!raw) throw new Error("MOBILE_SIGNING_SECRET is not set — the platform cannot keep signing keys without it");
  return scryptSync(raw, "lms.mobile.signing.v1", 32);
}

export function encrypt(plain: Buffer | string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([c.update(Buffer.isBuffer(plain) ? plain : Buffer.from(plain, "utf8")), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
export function decrypt(packed: string) {
  const raw = Buffer.from(packed, "base64");
  const d = createDecipheriv("aes-256-gcm", secret(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

export const signingEnabled = () => !!env("MOBILE_SIGNING_SECRET");

/** A password nobody ever types, so it can be as long as the format allows. */
const password = () => randomBytes(24).toString("base64url");

/**
 * Makes this company's key, once. Called by the first Android build and never again — `companyId` is unique,
 * so two builds starting together cannot end up with two different keys.
 */
export async function ensureKey(company: any, by = "system") {
  const existing = await MobileSigningKey.findOne({ companyId: company._id }).lean<any>();
  if (existing) return existing;
  if (!signingEnabled()) throw new Error("MOBILE_SIGNING_SECRET is not set — add it before building a signed app");

  const storePass = password();
  const keyPass = password();
  const alias = `${String(company.code || "app").toLowerCase().replace(/[^a-z0-9]/g, "")}key`;
  const file = join(await fs.mkdtemp(join(tmpdir(), "ks-")), "release.jks");

  // 10,000 days is what Google asks for: a key that expires takes the app with it
  const dn = `CN=${String(company.name || company.code).replace(/[,=]/g, " ").slice(0, 60)}, OU=Mobile, O=CredoOne, C=IN`;
  try {
    await run("keytool", [
      "-genkeypair", "-noprompt",
      "-keystore", file, "-storetype", "PKCS12",
      "-storepass", storePass, "-keypass", keyPass,
      "-alias", alias, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
      "-dname", dn,
    ]);
  } catch (e: any) {
    throw new Error(`Could not make the signing key: ${e?.stderr || e?.message || e}`);
  }

  const bytes = await fs.readFile(file);
  await fs.rm(join(file, ".."), { recursive: true, force: true });

  const doc = await MobileSigningKey.create({
    companyId: company._id,
    companyCode: company.code,
    platform: "android",
    alias,
    keystore: encrypt(bytes),
    storePass: encrypt(storePass),
    keyPass: encrypt(keyPass),
    fingerprint: await fingerprintOf(bytes, storePass, alias).catch(() => sha256(bytes)),
    createdBy: by,
  });
  return doc.toObject();
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex").toUpperCase().match(/.{2}/g)!.join(":");

/** The SHA-256 of the certificate — what Google Play and an installed phone compare. */
async function fingerprintOf(bytes: Buffer, storePass: string, alias: string) {
  const file = join(await fs.mkdtemp(join(tmpdir(), "fp-")), "k.jks");
  await fs.writeFile(file, bytes);
  try {
    const { stdout } = await run("keytool", ["-list", "-v", "-keystore", file, "-storepass", storePass, "-alias", alias]);
    const hit = /SHA256:\s*([0-9A-F:]+)/i.exec(stdout);
    return hit ? hit[1].toUpperCase() : sha256(bytes);
  } finally {
    await fs.rm(join(file, ".."), { recursive: true, force: true });
  }
}

/**
 * What the screens may see: the fingerprint, the alias, and the first version signed with it. Never the
 * keystore, and never a password.
 */
export async function signingSummary(company: any) {
  const key = await MobileSigningKey.findOne({ companyId: company._id }).lean<any>();
  if (!key) return { enabled: signingEnabled(), key: null as any };
  const first = await MobileBuild.find({ companyId: company._id, platform: "android", status: "ready", signedBy: "platform" })
    .sort({ createdAt: 1 })
    .limit(1)
    .lean<any[]>();
  // an app built before this key existed was signed with something else, so those phones need one reinstall
  const older = await MobileBuild.countDocuments({ companyId: company._id, platform: "android", status: "ready", signedBy: { $ne: "platform" } });
  return {
    enabled: true,
    key: {
      alias: key.alias,
      fingerprint: key.fingerprint,
      createdAt: key.createdAt,
      bundleId: company.mobile?.bundleId,
      since: first[0]?.version || null,
      needsReinstall: older > 0,
    },
  };
}

/**
 * The material itself, for the build and nothing else. The caller must already have checked the build's own
 * signature — this only unwraps what is stored.
 */
export async function keyForBuild(companyId: any) {
  const key = await MobileSigningKey.findOne({ companyId }).lean<any>();
  if (!key) return null;
  return {
    alias: key.alias,
    keystoreBase64: decrypt(key.keystore).toString("base64"),
    storePass: decrypt(key.storePass).toString("utf8"),
    keyPass: decrypt(key.keyPass).toString("utf8"),
  };
}

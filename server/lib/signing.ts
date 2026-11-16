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
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import forge from "node-forge";
import { MobileSigningKey, MobileBuild } from "../models";

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

  /**
   * The keystore is built here, in JavaScript, rather than by shelling out to `keytool`.
   *
   * keytool belongs to the JDK, and the platform runs on a Node runtime that has no JDK — the call failed
   * with `spawn keytool ENOENT`, which is not something a setting can fix. node-forge makes the same
   * artefact: an RSA key, a self-signed certificate, and a PKCS#12 keystore, which is exactly what
   * `keytool -storetype PKCS12` used to produce and what Gradle reads.
   */
  const alias = `${String(company.code || "app").toLowerCase().replace(/[^a-z0-9]/g, "")}key`;
  // PKCS#12 keeps one password for the store and the key; Java refuses a keystore where they differ
  const pass = randomBytes(24).toString("base64url");

  // the callback form yields between rounds; the synchronous one holds the event loop for seconds, which on
  // a shared server means every other request waits for one company's first build
  const keys = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) =>
    forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 }, (err, kp) => (err ? reject(err) : resolve(kp)))
  );
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `00${randomBytes(8).toString("hex")}`;
  cert.validity.notBefore = new Date();
  // Google asks for a certificate that outlives the app: one that expires takes the app with it
  cert.validity.notAfter = new Date(Date.now() + 10000 * 86_400_000);
  const dn = [
    { name: "commonName", value: String(company.name || company.code).replace(/[,=]/g, " ").slice(0, 60) },
    { name: "organizationalUnitName", value: "Mobile" },
    { name: "organizationName", value: "CredoOne" },
    { name: "countryName", value: "IN" },
  ];
  cert.setSubject(dn);
  cert.setIssuer(dn); // self-signed, as every Android app signing certificate is
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pass, { friendlyName: alias, algorithm: "3des" });
  const bytes = Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");

  const doc = await MobileSigningKey.create({
    companyId: company._id,
    companyCode: company.code,
    platform: "android",
    alias,
    keystore: encrypt(bytes),
    storePass: encrypt(pass),
    keyPass: encrypt(pass),
    fingerprint: fingerprintOf(cert),
    createdBy: by,
  });
  return doc.toObject();
}

/** The SHA-256 of the certificate — the same value `keytool -list -v` prints, and what Google Play compares. */
function fingerprintOf(cert: forge.pki.Certificate) {
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  return md.digest().toHex().toUpperCase().match(/.{2}/g)!.join(":");
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

/**
 * Which of the two signing routes is actually available, asked before a build rather than discovered ten
 * minutes into one.
 *
 *   platform — MOBILE_SIGNING_SECRET is set, so the platform makes and keeps a key per company.
 *   github   — the build repository holds ANDROID_KEYSTORE_BASE64 and its three companions.
 *   none     — neither, and an Android build will fail at the signing step.
 *
 * The GitHub half needs a call, so the answer is held for ten minutes. When GitHub cannot be reached the
 * answer is "unknown", never "none": refusing a build because we could not check would be worse than letting
 * the build itself report the truth.
 */
export type SigningRoute = "platform" | "github" | "none" | "unknown";

const ANDROID_SECRETS = ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];
let routeCache: { at: number; route: SigningRoute; missing: string[] } | null = null;

export async function signingRoute(fresh = false): Promise<{ route: SigningRoute; missing: string[] }> {
  if (signingEnabled()) return { route: "platform", missing: [] };
  if (!fresh && routeCache && Date.now() - routeCache.at < 600_000) return { route: routeCache.route, missing: routeCache.missing };

  const { listSecretNames } = await import("./githubsecrets");
  const names = await listSecretNames();
  // an empty list means either "no secrets" or "could not look"; both are reported as unknown rather than
  // standing in the way of a build
  if (!names.length) {
    const out = { route: "unknown" as SigningRoute, missing: [] as string[] };
    routeCache = { at: Date.now(), ...out };
    return out;
  }
  const missing = ANDROID_SECRETS.filter((k) => !names.includes(k));
  const out = { route: (missing.length ? "none" : "github") as SigningRoute, missing };
  routeCache = { at: Date.now(), ...out };
  return out;
}

/** The sentence a person needs when neither route is set up. One decision, two ways to make it. */
export const SIGNING_HELP =
  "An Android app has to be signed, and nothing here can sign it yet. Either set MOBILE_SIGNING_SECRET on the platform — one value, and it then makes and keeps a permanent key for every company by itself — or add the four ANDROID_* secrets to the build repository and manage the keystore yourself. The platform route is far less work; Knowledge Base › GitHub build has both.";

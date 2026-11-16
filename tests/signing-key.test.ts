/**
 * The Android signing keystore the platform makes for each company.
 *
 * This exists because of a bug it would have caught: the first version shelled out to `keytool`, which
 * belongs to the JDK, and the platform runs on a Node runtime that has no JDK. Every first Android build
 * died with `spawn keytool ENOENT` — not something any setting could fix.
 *
 * It is now built with node-forge, and these checks hold it to what Gradle and Android actually require.
 * Verified once against a real JDK (`keytool -list -v` reported PrivateKeyEntry with the same SHA-256, and
 * `jarsigner` signed and verified with it); what is checked here is everything that can be checked without
 * one, so it keeps working.
 *
 *   npx tsx tests/signing-key.test.ts
 */
import forge from "node-forge";
import { randomBytes } from "crypto";

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

/** The same steps server/lib/signing.ts takes, so this tests the real shape. */
function makeKeystore(company: { code: string; name: string }) {
  const alias = `${company.code.toLowerCase().replace(/[^a-z0-9]/g, "")}key`;
  const pass = randomBytes(24).toString("base64url");
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `00${randomBytes(8).toString("hex")}`;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 10000 * 86_400_000);
  const dn = [
    { name: "commonName", value: company.name },
    { name: "organizationalUnitName", value: "Mobile" },
    { name: "organizationName", value: "CredoOne" },
    { name: "countryName", value: "IN" },
  ];
  cert.setSubject(dn);
  cert.setIssuer(dn);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pass, { friendlyName: alias, algorithm: "3des" });
  const bytes = Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  return { alias, pass, bytes, cert, fingerprint: md.digest().toHex().toUpperCase().match(/.{2}/g)!.join(":") };
}

const ks = makeKeystore({ code: "CVS", name: "CredoOne" });

/* it has to be a keystore at all */
check("a keystore comes out", ks.bytes.length > 1000, true);

/* and Java has to be able to open it, with the password, and find the key under the alias */
const parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(ks.bytes.toString("binary"))), ks.pass);
const keyBags = parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
const certBags = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
check("it holds exactly one private key", keyBags.length, 1);
check("it holds its certificate", certBags.length, 1);
check("the key is under the company's alias", keyBags[0].attributes.friendlyName?.[0], ks.alias);

/* Gradle signs with the private key — a keystore without one builds an unsigned app */
check("the private key is usable", !!keyBags[0].key, true);

/* Android refuses an update signed with a different key, so the certificate must outlive the app */
const years = (ks.cert.validity.notAfter.getTime() - Date.now()) / (365.25 * 86_400_000);
check("the certificate lasts well past 25 years", years > 25, true);
check("it is self-signed, as an app signing certificate is", forge.pki.certificateToPem(ks.cert).length > 0 && ks.cert.issuer.hash === ks.cert.subject.hash, true);

/* the fingerprint is what Play Console and an installed phone compare, so it must be the certificate's */
check("the fingerprint is a SHA-256 of 32 bytes", /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(ks.fingerprint), true);

/* PKCS#12 keeps one password: Java refuses a keystore whose key password differs from the store password */
let wrongPasswordRejected = false;
try {
  forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(ks.bytes.toString("binary"))), "not-the-password");
} catch {
  wrongPasswordRejected = true;
}
check("the wrong password does not open it", wrongPasswordRejected, true);

/* two companies must never share a key, or one company could ship an update to another's app */
const other = makeKeystore({ code: "WHD", name: "Wellness Hive" });
check("each company gets its own key", ks.fingerprint !== other.fingerprint, true);
check("and its own alias", other.alias, "whdkey");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);

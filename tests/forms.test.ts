/**
 * The editable campaign form, and the app's editable sign-in screen.
 *
 * Both features replace something that was written into the source with something read from a record. That
 * shape of change has one dangerous failure and several quiet ones:
 *
 *   **The dangerous one.** Every QR code already printed on a leaflet points at a form that has never been
 *   edited. If "no form saved" stops meaning "the form exactly as it was", every one of those leaflets now
 *   leads somewhere different. Most of this file is that single promise, asserted value by value.
 *
 *   **The quiet ones.** A field whose answer is collected and then dropped on the floor. A core key
 *   renamed so the form still looks right while the lead's phone column stops filling. A second copy of a
 *   sentence in the app that drifts from the first. None of these fail anything at the time.
 *
 *   npx tsx tests/forms.test.ts
 */
import { readFileSync } from "fs";
import { normalise, visible, validate, extraKeys, DEFAULT_FIELDS, DEFAULT_CONSENT, CORE_KEYS } from "../shared/formspec";
import { mobileBrand, DEFAULT_SUBTITLE, BRAND_ASSET_KINDS } from "../shared/mobilebrand";

let fails = 0;
const ok = (name: string, cond: boolean, why = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !why ? "" : `\n        ${why}`}`);
};

/* ============================================================ the promise to every printed QR code ===== */

const asShipped = normalise(undefined);

ok(
  "a connector with no saved form still has exactly four fields",
  asShipped.fields.length === 4,
  `got ${asShipped.fields.length}: ${asShipped.fields.map((f) => f.key).join(", ")}`
);

for (const [i, want] of DEFAULT_FIELDS.entries()) {
  const got = asShipped.fields[i];
  ok(
    `field ${i + 1} is still ${want.key}, worded as before`,
    got?.key === want.key && got?.label === want.label && got?.placeholder === want.placeholder && got?.type === want.type && !!got?.required === !!want.required,
    `expected ${JSON.stringify(want)}\n        got      ${JSON.stringify(got)}`
  );
}

ok("the consent sentence is unchanged", asShipped.consentText === DEFAULT_CONSENT, asShipped.consentText);
ok("consent is still optional to tick", asShipped.consentRequired === false, "ticking was never required; making it so would turn away people who submit today");
ok("the button still says Submit", asShipped.submitLabel === "Submit", asShipped.submitLabel);
ok("the thank-you wording is unchanged", asShipped.thankYouTitle === "Thank you!" && asShipped.thankYouText === "Our team will contact you shortly.");
ok("nothing extra is carried to the lead by default", extraKeys(asShipped).length === 0);

/*
 * The old page's own wording, quoted literally.
 *
 * The loop above compares what `normalise` produces against DEFAULT_FIELDS, which catches a bug in
 * normalise but not a reworded default — both sides would move together. These two lists are the fixed
 * point: they are what the page said before any of this existed, and changing them has to be deliberate.
 */
const OLD_PLACEHOLDERS = ["Your name", "Mobile number (10 digits)", "Email (optional)", "What are you looking for? (test, package, consultation…)"];
const OLD_KEYS = ["name", "phone", "email", "message"];
ok(
  "every placeholder matches the page that was replaced",
  asShipped.fields.map((f) => f.placeholder).join("|") === OLD_PLACEHOLDERS.join("|"),
  asShipped.fields.map((f) => f.placeholder).join(" | ")
);
ok(
  "the four keys are the four the lead mapping reads",
  asShipped.fields.map((f) => f.key).join("|") === OLD_KEYS.join("|"),
  asShipped.fields.map((f) => f.key).join(" | ")
);
ok(
  "only name and phone are required, as before",
  asShipped.fields.filter((f) => f.required).map((f) => f.key).join("|") === "name|phone",
  "the old page marked exactly these two required; adding a third turns away people who submit today"
);

/* ============================================================ the keys that fill the lead's columns ==== */

ok(
  "a stored form that never mentions name still has one",
  normalise({ fields: [{ key: "phone", label: "Mobile", type: "phone" }] }).fields.some((f) => f.key === "name"),
  "a form with nowhere to type a name produces leads nobody can greet"
);
ok(
  "name and phone cannot be switched off",
  normalise({ fields: [{ key: "name", on: false }, { key: "phone", on: false }] }).fields.filter((f) => ["name", "phone"].includes(f.key)).every((f) => f.on !== false),
  "a lead is a person and a way to reach them; without both there is nothing to act on"
);
ok(
  "name and phone stay required however they are stored",
  normalise({ fields: [{ key: "name", required: false }, { key: "phone", required: false }] }).fields.filter((f) => ["name", "phone"].includes(f.key)).every((f) => f.required),
  ""
);
ok(
  "e-mail and the message may be switched off",
  visible(normalise({ fields: [{ key: "email", core: true, on: false }] })).every((f) => f.key !== "email"),
  "these two are optional on the lead, so a company may stop asking"
);
ok(
  "a core field keeps its type even if the record says otherwise",
  normalise({ fields: [{ key: "phone", type: "text" }] }).fields.find((f) => f.key === "phone")?.type === "phone",
  "the type is what validates the number that fills the lead's phone column"
);
ok(
  "a field cannot take a key that means something else on the way in",
  !normalise({ fields: [{ key: "consent", label: "Consent", type: "text" }, { key: "utm_source", label: "Source", type: "text" }] }).fields.some((f) => ["utm_source"].includes(f.key)),
  "a field keyed utm_source would overwrite the campaign tracking the lead arrived with"
);
ok(
  "two fields cannot share a key",
  normalise({ fields: [{ key: "colour", label: "Colour", type: "text" }, { key: "colour", label: "Colour again", type: "text" }] }).fields.filter((f) => f.key === "colour").length === 1
);
ok("a label becomes a usable key", normalise({ fields: [{ label: "Which branch?", type: "text" }] }).fields.some((f) => f.key === "which_branch"));

/* ============================================================ what the visitor is told =================== */

const spec = normalise({
  fields: [
    { key: "name" },
    { key: "phone" },
    { key: "branch", label: "Branch", type: "select", options: ["Salt Lake", "Howrah"], required: true },
    { key: "age", label: "Age", type: "number" },
  ],
  consentRequired: true,
});

ok("a required answer that is missing is named", validate(spec, { name: "A", phone: "9876543210" }) === "Branch is required");
ok("a phone that is not a mobile number is named", validate(spec, { name: "A", phone: "12345" })?.includes("10-digit") === true);
ok("an answer outside the options is refused", validate(spec, { name: "A", phone: "9876543210", branch: "Mars" })?.startsWith("Choose one") === true);
ok("a number field refuses words", validate(spec, { name: "A", phone: "9876543210", branch: "Howrah", age: "old" }) === "Age must be a number");
ok("consent is enforced when it was made compulsory", validate(spec, { name: "A", phone: "9876543210", branch: "Howrah" })?.includes("consent") === true);
ok("a complete submission passes", validate(spec, { name: "A", phone: "9876543210", branch: "Howrah", consent: "yes" }) === undefined);
ok("an e-mail that is not one is named", validate(normalise({ fields: [{ key: "email", required: true }] }), { name: "A", phone: "9876543210", email: "nope" })?.includes("e-mail") === true);
ok("the added fields are the ones carried to the lead", extraKeys(spec).join(",") === "branch,age", extraKeys(spec).join(","));

/* ============================================================ the answer must actually be kept =========== */

const intake = readFileSync("server/lib/intake.ts", "utf8");
ok(
  "answers to added questions are carried onto the lead",
  /customFields = \{ \.\.\.\(lead\.customFields \|\| \{\}\), \.\.\.extras \}/.test(intake),
  "mapFields keeps only the keys it recognises — without this the question is asked and the answer is dropped"
);
ok(
  "…and only the keys the saved form declares",
  /for \(const f of visibleFields\(normaliseForm\(spec\)\)\)/.test(intake),
  "copying whatever was posted would let anyone push arbitrary data onto a lead"
);
ok(
  "a connector with no saved form is not touched by any of it",
  /const spec = connector\.config\?\.form;\s*\n\s*if \(spec\) \{/.test(intake),
  "the untouched path must stay exactly as it was"
);

const pub = readFileSync("server/routes/public.ts", "utf8");
ok(
  "the public endpoint enforces the form's own rules",
  /if \(isBrowserForm && c\.config\?\.form\)/.test(pub) && /validateForm\(normaliseForm\(c\.config\.form\), body\)/.test(pub),
  "the browser's checks are a courtesy; anybody can post here directly"
);
ok(
  "…and only for a browser posting to a connector that has one",
  /isBrowserForm && c\.config\?\.form/.test(pub),
  "validating REST and webhook callers of a website-form connector would break integrations that work today"
);
ok("the form page is sent the spec", /form: normaliseForm\(c\.config\?\.form\)/.test(pub));

const page = readFileSync("src/app/f/[key]/page.tsx", "utf8");
ok("the public page draws the fields it is sent", /fields\.map\(\(field\) =>/.test(page) && /normalise\(info\?\.form\)/.test(page));
ok("the consent text sent with the lead is the one shown", /consent_text: spec\.consentText/.test(page), "recording a sentence the visitor never saw is worse than recording none");

/* ============================================================ the app's sign-in screen ================== */

const asset = (kind: string, key?: string) => (key ? `/api/public/brand-asset/X/${kind}` : undefined);
const plain = mobileBrand({ name: "CredoOne", branding: {} }, asset);

ok("a company that sets nothing keeps the company name", plain.heading === "CredoOne");
ok("…the sentence that was written into the app", plain.subtitle === DEFAULT_SUBTITLE);
ok("…the two-letter circle", plain.initials === "CR", plain.initials);
ok("…the version line", plain.showVersion === true);
ok("…and no banner", plain.bannerUrl === undefined);
ok("a company logo is used for the app when there is one", mobileBrand({ name: "X", branding: { logoKey: "k" } }, asset).logoUrl?.includes("/logo") === true);
ok("an app logo wins over the company logo", mobileBrand({ name: "X", branding: { logoKey: "k", appLogoKey: "a" } }, asset).logoUrl?.includes("/appLogo") === true);
ok(
  "the circle can be kept deliberately",
  mobileBrand({ name: "X", branding: { logoKey: "k", mobile: { useCompanyLogo: false } } }, asset).logoUrl === undefined,
  "unticking it must mean the initials, not the company logo"
);
ok("the app name from white-labelling wins", mobileBrand({ name: "X", branding: {}, whiteLabel: { appNames: { mobile: "Hive" } } }, asset).appName === "Hive");

/**
 * The app cannot import `shared/`, so this sentence exists twice. Two copies of a string are two strings
 * that drift: the screen would then say one thing before it reaches the network and another after.
 */
const appBrand = readFileSync("mobile/src/lib/brand.ts", "utf8");
const appCopy = /DEFAULT_SUBTITLE = "([^"]+)"/.exec(appBrand)?.[1];
ok(
  "the app's copy of the sign-in sentence matches the server's, word for word",
  appCopy === DEFAULT_SUBTITLE,
  `app:    ${appCopy}\n        server: ${DEFAULT_SUBTITLE}`
);
ok(
  "the app does not import from shared/",
  !/from "(@shared|\.\.\/\.\.\/\.\.\/shared)/.test(readFileSync("mobile/src/screens/SignIn.tsx", "utf8") + appBrand),
  "the build repository receives only mobile/ — a shared import there is checklist row 14 happening again"
);
ok(
  "the screen never waits for the network to draw",
  /useState<AppBrand>\(builtIn\)/.test(readFileSync("mobile/src/screens/SignIn.tsx", "utf8")),
  "starting from nothing would give a blank frame on every launch before the cache is read"
);
ok("the cached copy is merged over the built-in values", /\{ \.\.\.builtIn\(\), \.\.\.JSON\.parse\(raw\) \}/.test(appBrand), "a cache written by an older app is missing fields added since");

/* ============================================================ one list of image kinds =================== */

ok("the app's two image kinds are part of the one list", BRAND_ASSET_KINDS.includes("appLogo" as any) && BRAND_ASSET_KINDS.includes("appBanner" as any));
for (const [file, label] of [
  ["server/routes/sa/index.ts", "upload"],
  ["server/routes/public.ts", "public read"],
] as const)
  ok(
    `the ${label} route reads that one list`,
    /BRAND_ASSET_KINDS/.test(readFileSync(file, "utf8")),
    "three hand-written lists is how an image uploads and then 404s when it is read back"
  );

ok(
  "the Super Admin screen can pick the app's images",
  /"appLogo"/.test(readFileSync("src/components/sa/CompanyBranding.tsx", "utf8")),
  "the kinds can be accepted everywhere and still have nowhere to choose them"
);
ok("every core key is accounted for in the builder", CORE_KEYS.every((k) => readFileSync("shared/formspec.ts", "utf8").includes(`key: "${k}"`)));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);

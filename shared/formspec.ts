/**
 * What a QR-code / campaign form is made of.
 *
 * The hosted form used to be four fixed inputs written into the page. This describes the same form as data,
 * so a company can change its labels, add fields of its own and reword the consent line without anyone
 * touching code.
 *
 * **A connector with no form saved behaves exactly as it did before.** `normalise(undefined)` returns the
 * four original fields, the original consent sentence and the original wording, so every form already in
 * use keeps working unchanged and no migration is needed. That is the single most important property here
 * and there is a test asserting it field by field.
 *
 * Shared by the server (which validates what is posted) and both browsers (the builder and the public
 * page), so the three can never disagree about what a form is. The mobile app does not import this — the
 * build repository only receives `mobile/`, which is how a shared file broke the app build once before.
 */

export type FieldType = "text" | "phone" | "email" | "textarea" | "number" | "date" | "select" | "radio" | "checkbox";

export type FormField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  /** select and radio only */
  options?: string[];
  /**
   * True for the four fields that become columns on the lead itself. They may be relabelled, reordered and
   * (except name and phone) switched off, but their keys cannot change — the key is what the lead mapping
   * reads, and renaming it would quietly stop filling the column it feeds.
   */
  core?: boolean;
  /** core fields only: unticked means the field is not shown at all */
  on?: boolean;
};

export type FormSpec = {
  heading?: string;
  intro?: string;
  submitLabel: string;
  consentText: string;
  consentRequired: boolean;
  thankYouTitle: string;
  thankYouText: string;
  fields: FormField[];
};

/** The keys that map onto the lead record. Everything else is kept in the lead's custom fields. */
export const CORE_KEYS = ["name", "phone", "email", "message"] as const;
/** A lead is identified by who it is and how to call them, so these two are always shown and always required. */
export const ALWAYS_ON = ["name", "phone"] as const;

/** Exactly the form that shipped before it was editable — the fallback for every connector without one. */
export const DEFAULT_FIELDS: FormField[] = [
  { key: "name", label: "Your name", type: "text", required: true, placeholder: "Your name", core: true, on: true },
  { key: "phone", label: "Mobile number", type: "phone", required: true, placeholder: "Mobile number (10 digits)", core: true, on: true },
  { key: "email", label: "Email", type: "email", required: false, placeholder: "Email (optional)", core: true, on: true },
  {
    key: "message",
    label: "What are you looking for?",
    type: "textarea",
    required: false,
    placeholder: "What are you looking for? (test, package, consultation…)",
    core: true,
    on: true,
  },
];

export const DEFAULT_CONSENT = "I agree to be contacted on WhatsApp / phone about my enquiry.";
export const DEFAULT_THANKS_TITLE = "Thank you!";
export const DEFAULT_THANKS_TEXT = "Our team will contact you shortly.";

export const FIELD_TYPES: [FieldType, string][] = [
  ["text", "Single line"],
  ["textarea", "Paragraph"],
  ["email", "E-mail"],
  ["phone", "Phone"],
  ["number", "Number"],
  ["date", "Date"],
  ["select", "Dropdown"],
  ["radio", "Choice"],
  ["checkbox", "Tick box"],
];

const str = (v: any, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/** A key safe to post and to store: lower case, letters, digits and underscores. */
export const toKey = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

/** Keys the form may not use for a field of its own, because they mean something else on the way in. */
const RESERVED = new Set(["consent", "consent_text", "_hp", "website_url_hp", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "key", "token"]);

/**
 * Anything stored, half-written or absent → a complete, usable spec.
 *
 * Written so the public page never has to defend itself: whatever comes back from here has every field it
 * needs, no duplicate keys, no reserved keys, and the two fields a lead cannot exist without.
 */
export function normalise(raw: any): FormSpec {
  const given: any[] = Array.isArray(raw?.fields) ? raw.fields : [];
  const out: FormField[] = [];
  const seen = new Set<string>();

  for (const f of given) {
    const core = CORE_KEYS.includes(f?.key);
    const key = core ? f.key : toKey(f?.key || f?.label);
    if (!key || seen.has(key)) continue;
    if (!core && RESERVED.has(key)) continue;
    seen.add(key);

    const base = DEFAULT_FIELDS.find((d) => d.key === key);
    const type: FieldType = core ? (base!.type as FieldType) : FIELD_TYPES.some(([t]) => t === f?.type) ? f.type : "text";
    const options = type === "select" || type === "radio" ? (Array.isArray(f?.options) ? f.options.map((o: any) => String(o).trim()).filter(Boolean).slice(0, 40) : []) : undefined;

    out.push({
      key,
      label: str(f?.label, base?.label || key),
      type,
      required: ALWAYS_ON.includes(key as any) ? true : !!f?.required,
      placeholder: str(f?.placeholder, base?.placeholder || ""),
      ...(options ? { options } : {}),
      ...(core ? { core: true, on: ALWAYS_ON.includes(key as any) ? true : f?.on !== false } : {}),
    });
  }

  /* a spec that never mentioned a core field still gets it, so an old or hand-edited record cannot
     produce a form with nowhere to type a name */
  for (const d of DEFAULT_FIELDS) if (!seen.has(d.key)) out.splice(DEFAULT_FIELDS.indexOf(d), 0, { ...d });

  return {
    heading: str(raw?.heading) || undefined,
    intro: str(raw?.intro) || undefined,
    submitLabel: str(raw?.submitLabel, "Submit"),
    consentText: str(raw?.consentText, DEFAULT_CONSENT),
    consentRequired: raw?.consentRequired === true,
    thankYouTitle: str(raw?.thankYouTitle, DEFAULT_THANKS_TITLE),
    thankYouText: str(raw?.thankYouText, DEFAULT_THANKS_TEXT),
    fields: out.slice(0, 40),
  };
}

/** The fields a visitor actually sees: core fields that are switched on, plus every added field. */
export const visible = (spec: FormSpec) => spec.fields.filter((f) => !f.core || f.on !== false);

/** Keys that are not lead columns — these are the ones that must be carried into the lead's custom fields. */
export const extraKeys = (spec: FormSpec) => visible(spec).filter((f) => !f.core).map((f) => f.key);

/**
 * Checks a submission against the spec. Returns the first problem in the visitor's words, or nothing.
 *
 * The same function runs in the browser and on the server. The browser's copy is a courtesy; the server's
 * is the one that counts, because the form posts to a public endpoint that anybody can call directly.
 */
export function validate(spec: FormSpec, body: Record<string, any>): string | undefined {
  for (const f of visible(spec)) {
    const v = body[f.key];
    const empty = v == null || String(v).trim() === "" || (f.type === "checkbox" && v !== true && v !== "yes" && v !== "on");
    if (f.required && empty) return `${f.label} is required`;
    if (empty) continue;
    const s = String(v).trim();
    if (f.type === "phone" && !/^[6-9][0-9]{9}$/.test(s.replace(/\D/g, ""))) return `${f.label} must be a 10-digit mobile number`;
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `${f.label} must be an e-mail address`;
    if (f.type === "number" && !Number.isFinite(Number(s))) return `${f.label} must be a number`;
    if ((f.type === "select" || f.type === "radio") && f.options?.length && !f.options.includes(s)) return `Choose one of the options for ${f.label}`;
  }
  if (spec.consentRequired && !/^(y|yes|true|1|on)$/i.test(String(body.consent ?? ""))) return "Please tick the consent box to continue";
  return undefined;
}

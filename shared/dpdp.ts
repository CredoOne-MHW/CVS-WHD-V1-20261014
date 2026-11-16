/**
 * DPDP Act consent — the notice a company must show before it collects anyone's personal data, and the
 * record that the person actually read and accepted it.
 *
 * One document per company (the platform keeps a default that a company starts from). It is published at a
 * link the website, the apps and the CRM open; the person scrolls it to the end before Accept turns on, and
 * there is no way to decline past it — closing the window simply means no consent was given, and nothing is
 * recorded as accepted.
 */

export const DPDP_VERSION_LABEL = "DPDP Act, 2023";

/** What a company may do with the data, each ticked separately and each recorded. */
export const DPDP_PURPOSES = [
  { key: "contact", label: "Contact me about my enquiry", required: true, description: "Calls, WhatsApp, SMS and e-mail about the enquiry or service I asked for." },
  { key: "service", label: "Provide and manage the service", required: true, description: "Setting up and running the service, invoices, receipts and support." },
  { key: "records", label: "Keep records as the law requires", required: true, description: "Books of account, tax records and anything a regulator may ask for." },
  { key: "marketing", label: "Send me offers and updates", required: false, description: "Occasional news, offers and product updates. May be withdrawn at any time." },
  { key: "analytics", label: "Improve the service", required: false, description: "Measuring how the service is used, in a form that does not identify me." },
] as const;
export type DpdpPurpose = (typeof DPDP_PURPOSES)[number]["key"];
export const REQUIRED_PURPOSES = DPDP_PURPOSES.filter((p) => p.required).map((p) => p.key);

/** Cookie groups shown in the banner. "necessary" is always on and cannot be switched off. */
export const COOKIE_CATEGORIES = [
  { key: "necessary", label: "Strictly necessary", locked: true, description: "Signing in, security and remembering what you typed. The site does not work without them." },
  { key: "preferences", label: "Preferences", locked: false, description: "Language, layout and the choices you made last time." },
  { key: "analytics", label: "Analytics", locked: false, description: "Which pages are opened and for how long, so the site can be improved." },
  { key: "marketing", label: "Marketing", locked: false, description: "Measuring campaigns and showing relevant offers." },
] as const;
export type CookieCategory = (typeof COOKIE_CATEGORIES)[number]["key"];

/** Where a consent came from. */
export const CONSENT_SOURCES = ["website", "app", "crm", "form", "import"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Who gave it. A visitor is someone not signed in — identified only by the browser id they were given. */
export const SUBJECT_KINDS = ["visitor", "lead", "client", "user"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/**
 * Placeholders a document may use. The platform's default notice is written with these, so one text serves
 * every company: each company's own name and details are filled in when the notice is shown.
 */
export const DPDP_VARS = [
  { key: "company.name", label: "Company name" },
  { key: "company.legalName", label: "Legal name" },
  { key: "company.address", label: "Address" },
  { key: "company.email", label: "Contact e-mail" },
  { key: "company.phone", label: "Contact phone" },
  { key: "company.website", label: "Website address" },
  { key: "company.officer", label: "Grievance officer" },
  { key: "company.officerEmail", label: "Grievance officer e-mail" },
  { key: "today", label: "Today's date" },
] as const;

/** Fills {{company.name}} and friends. Unknown placeholders are left as they are, so nothing disappears silently. */
export function fillVars(text: string, vars: Record<string, string | undefined>) {
  return String(text || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key) => (vars[key] != null && vars[key] !== "" ? String(vars[key]) : whole));
}

/** Which placeholders a document still has that the company has not filled in. */
export function missingVars(text: string, vars: Record<string, string | undefined>) {
  const out = new Set<string>();
  for (const m of String(text || "").matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) if (!vars[m[1]]) out.add(m[1]);
  return [...out];
}

/** A person has read the notice when they reached the end and spent a sensible amount of time on it. */
export const READ_RULES = { minScrollPct: 98, minSeconds: 5 };
export const hasRead = (scrollPct: number, seconds: number) => scrollPct >= READ_RULES.minScrollPct && seconds >= READ_RULES.minSeconds;

/** The platform's default notice. A company may use it as it is, edit it, or upload its own. */
export const DEFAULT_NOTICE = `# Notice of collection and processing of personal data

**{{company.name}}** ("we", "us") gives you this notice under the Digital Personal Data Protection Act, 2023, before we collect or use your personal data.

## 1. Who is asking

{{company.legalName}}
{{company.address}}
E-mail: {{company.email}} · Phone: {{company.phone}}

We are the Data Fiduciary for the personal data described below.

## 2. What we collect

- Your name, phone number, WhatsApp number and e-mail address.
- The company you represent, where you tell us.
- What you asked us about, and the messages between us.
- Service and payment records, once you become our customer.
- Technical records of your visit — the address of your device, the pages you opened and the time of the visit.

We do not ask you for your government identity numbers, your financial account numbers or any special category of data to answer an enquiry. Please do not send them to us in a message.

## 3. Why we use it

- To reply to your enquiry and to contact you about it.
- To set up, provide and support the service you asked for.
- To raise invoices and receipts, and to keep the records the law requires us to keep.
- Where you have ticked it: to send you offers and updates, and to understand how our service is used.

We use your data only for the purposes you agreed to. If we ever want to use it for something else, we will ask you again.

## 4. How long we keep it

We keep enquiry records for as long as we are in touch with you about them and for a reasonable period afterwards, and customer and payment records for as long as tax and company law requires. After that the records are deleted on a schedule we set and follow.

## 5. Who else sees it

- Our own staff, so far as their work requires it.
- Service providers who run our systems on our instructions — hosting, messaging and payment providers — under contracts that stop them using your data for anything else.
- A court, a regulator or a government body, where the law obliges us.

We do not sell your personal data.

## 6. Your rights

Under the Act you may ask us to:

- tell you what data of yours we hold and what we have done with it;
- correct or complete anything that is wrong;
- erase data we no longer need;
- nominate someone to act for you if you cannot;
- withdraw a consent you gave — as easily as you gave it.

Write to our Grievance Officer, **{{company.officer}}**, at {{company.officerEmail}}. We will answer within the time the Act allows. If you are not satisfied, you may complain to the Data Protection Board of India.

## 7. Withdrawing consent

You may withdraw any consent that is not required to provide the service. Processing we did before you withdrew remains lawful, and we may still keep what the law requires us to keep.

## 8. Children

We do not knowingly process the personal data of anyone under 18 without the consent of a parent or guardian.

_This notice was last updated on {{today}}._`;

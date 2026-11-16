/**
 * The company website — a small site each company gets, whatever its industry.
 *
 * Every section is described here: what it is called, what it holds and what each field looks like. The
 * builder renders itself from this list and so does the public page, so adding a section is one entry and
 * nothing else. Nothing in the wording assumes a trade: a clinic, a school, a broker and a restaurant all
 * use the same sections, and a company can rename any of them for itself (`title` is editable everywhere).
 */

export type FieldType = "text" | "textarea" | "richtext" | "image" | "url" | "color" | "select" | "toggle" | "list";

export interface SiteField {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  placeholder?: string;
  options?: string[]; // select
  max?: number;
  /** list fields: what one row holds */
  of?: { key: string; label: string; type: FieldType; placeholder?: string }[];
}

export interface SiteSection {
  key: string;
  group: "Site" | "Home page" | "Pages";
  label: string;
  description: string;
  /** a section that cannot be switched off (the site needs it) */
  always?: boolean;
  fields: SiteField[];
}

const LINK_ROW = [
  { key: "label", label: "Text", type: "text" as FieldType, placeholder: "Our services" },
  { key: "href", label: "Link", type: "text" as FieldType, placeholder: "/services" },
];

export const SITE_SECTIONS: SiteSection[] = [
  /* ── Site ─────────────────────────────────────────────────────────────── */
  {
    key: "design",
    group: "Site",
    label: "Design & colours",
    description: "The look of every page. Starts from the company's brand colours.",
    always: true,
    fields: [
      { key: "theme", label: "Layout", type: "select", options: ["Classic", "Editorial", "Bold", "Minimal"], hint: "How the sections are arranged and spaced" },
      { key: "useBrandColors", label: "Use the company's brand colours", type: "toggle" },
      { key: "primary", label: "Primary colour", type: "color", hint: "Buttons, links and headings" },
      { key: "accent", label: "Accent colour", type: "color" },
      { key: "font", label: "Font", type: "select", options: ["Plus Jakarta Sans", "Inter", "Manrope", "Figtree", "Source Sans 3", "IBM Plex Sans"] },
      { key: "corners", label: "Corners", type: "select", options: ["Rounded", "Soft", "Square"] },
    ],
  },
  {
    key: "menu",
    group: "Site",
    label: "Pages & menu",
    description: "What appears in the top menu, and the button beside it.",
    always: true,
    fields: [
      { key: "items", label: "Menu items", type: "list", of: LINK_ROW, max: 8 },
      { key: "ctaLabel", label: "Button text", type: "text", placeholder: "Talk to us" },
      { key: "ctaHref", label: "Button link", type: "text", placeholder: "#enquiry" },
      { key: "showLogo", label: "Show the company logo", type: "toggle" },
    ],
  },
  {
    key: "seo",
    group: "Site",
    label: "SEO & sharing",
    description: "The title and picture shown by search engines and when the link is shared.",
    always: true,
    fields: [
      { key: "title", label: "Page title", type: "text", placeholder: "Company name — what you do" },
      { key: "description", label: "Description", type: "textarea", hint: "About 150 characters", max: 300 },
      { key: "keywords", label: "Keywords", type: "text", hint: "Comma separated" },
      { key: "shareImage", label: "Sharing image", type: "image", hint: "1200×630" },
      { key: "noIndex", label: "Ask search engines not to list this site", type: "toggle" },
    ],
  },
  {
    key: "announcement",
    group: "Site",
    label: "Announcement bar",
    description: "A thin line across the top of every page.",
    fields: [
      { key: "text", label: "Message", type: "text", placeholder: "Now open on Sundays" },
      { key: "href", label: "Link", type: "text", placeholder: "/offers" },
      { key: "background", label: "Background", type: "color" },
    ],
  },

  /* ── Home page ────────────────────────────────────────────────────────── */
  {
    key: "hero",
    group: "Home page",
    label: "Hero banner",
    description: "The first thing a visitor sees.",
    always: true,
    fields: [
      { key: "eyebrow", label: "Small line above the title", type: "text" },
      { key: "title", label: "Title", type: "text" },
      { key: "subtitle", label: "Sub-title", type: "textarea", max: 400 },
      { key: "image", label: "Background image", type: "image" },
      { key: "darken", label: "Darken the image", type: "select", options: ["0%", "25%", "50%", "70%"] },
      { key: "button1", label: "Button 1", type: "text", placeholder: "Our services" },
      { key: "button1Href", label: "Link", type: "text", placeholder: "#services" },
      { key: "button2", label: "Button 2", type: "text", placeholder: "Find us" },
      { key: "button2Href", label: "Link", type: "text", placeholder: "#contact" },
      { key: "quote", label: "Quote band under the hero", type: "text" },
    ],
  },
  {
    key: "story",
    group: "Home page",
    label: "Story (intro)",
    description: "A short paragraph about the company.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "Who we are" },
      { key: "body", label: "Text", type: "textarea", max: 1200 },
      { key: "image", label: "Picture", type: "image" },
    ],
  },
  {
    key: "highlights",
    group: "Home page",
    label: "What we do",
    description: "Three to six things the company is known for. Rename it for your trade — services, specialities, courses, products.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "What we do" },
      { key: "items", label: "Items", type: "list", max: 9, of: [
        { key: "title", label: "Title", type: "text" },
        { key: "text", label: "Description", type: "textarea" },
        { key: "icon", label: "Icon", type: "text", placeholder: "Stethoscope" },
      ] },
    ],
  },
  {
    key: "featured",
    group: "Home page",
    label: "Featured items",
    description: "The products, services or packages to put in front. Pulls from Service / product when left empty.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "Popular with our customers" },
      { key: "fromServices", label: "Use the company's Service / product list", type: "toggle" },
      { key: "items", label: "Items", type: "list", max: 12, of: [
        { key: "name", label: "Name", type: "text" },
        { key: "price", label: "Price", type: "text", placeholder: "₹1,499" },
        { key: "text", label: "Description", type: "textarea" },
        { key: "image", label: "Picture", type: "image" },
      ] },
    ],
  },
  {
    key: "offers",
    group: "Home page",
    label: "Offers",
    description: "Current offers, packages or combinations.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "Offers" },
      { key: "items", label: "Offers", type: "list", max: 8, of: [
        { key: "name", label: "Name", type: "text" },
        { key: "text", label: "Details", type: "textarea" },
        { key: "until", label: "Valid until", type: "text" },
      ] },
    ],
  },
  {
    key: "testimonials",
    group: "Home page",
    label: "Testimonials",
    description: "What customers say. Only publish what they actually said.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "What our customers say" },
      { key: "items", label: "Testimonials", type: "list", max: 12, of: [
        { key: "quote", label: "Quote", type: "textarea" },
        { key: "name", label: "Name", type: "text" },
        { key: "role", label: "Where from", type: "text", placeholder: "Kolkata" },
      ] },
    ],
  },
  {
    key: "gallery",
    group: "Home page",
    label: "Gallery",
    description: "Pictures of the place, the team or the work.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "A look around" },
      { key: "images", label: "Pictures", type: "list", max: 18, of: [
        { key: "url", label: "Picture", type: "image" },
        { key: "caption", label: "Caption", type: "text" },
      ] },
    ],
  },
  {
    key: "cta",
    group: "Home page",
    label: "Closing call-to-action",
    description: "The last band before the footer.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "Ready when you are" },
      { key: "text", label: "Text", type: "textarea" },
      { key: "button", label: "Button", type: "text", placeholder: "Send an enquiry" },
      { key: "href", label: "Link", type: "text", placeholder: "#enquiry" },
    ],
  },

  /* ── Pages ────────────────────────────────────────────────────────────── */
  {
    key: "about",
    group: "Pages",
    label: "About us",
    description: "The longer story, the team and the credentials.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "About us" },
      { key: "body", label: "Text", type: "richtext", max: 8000 },
      { key: "image", label: "Picture", type: "image" },
    ],
  },
  {
    key: "enquiry",
    group: "Pages",
    label: "Enquiry form",
    description: "The form that creates a lead. Every submission lands in Leads, through the same channel rules as any other source.",
    always: true,
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "Talk to us" },
      { key: "text", label: "Text above the form", type: "textarea" },
      { key: "askCompany", label: "Ask for the company name", type: "toggle" },
      { key: "askService", label: "Ask which service they want", type: "toggle" },
      { key: "askMessage", label: "Ask for a message", type: "toggle" },
      { key: "campaign", label: "Campaign to tag these leads with", type: "text", placeholder: "website" },
      { key: "thanks", label: "Thank-you message", type: "textarea", placeholder: "Thank you — we will call you shortly." },
    ],
  },
  {
    key: "faq",
    group: "Pages",
    label: "FAQ",
    description: "Questions worth answering before someone asks.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "Questions we are asked" },
      { key: "items", label: "Questions", type: "list", max: 20, of: [
        { key: "q", label: "Question", type: "text" },
        { key: "a", label: "Answer", type: "textarea" },
      ] },
    ],
  },
  {
    key: "contact",
    group: "Pages",
    label: "Contact, hours & social",
    description: "Where you are, when you are open and where to find you online.",
    always: true,
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "Find us" },
      { key: "address", label: "Address", type: "textarea" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "whatsapp", label: "WhatsApp", type: "text" },
      { key: "email", label: "E-mail", type: "text" },
      { key: "mapUrl", label: "Map link", type: "url" },
      { key: "hours", label: "Opening hours", type: "list", max: 7, of: [
        { key: "day", label: "Day", type: "text", placeholder: "Mon – Fri" },
        { key: "time", label: "Hours", type: "text", placeholder: "9:00 – 18:00" },
      ] },
      { key: "social", label: "Social links", type: "list", max: 8, of: LINK_ROW },
    ],
  },
  {
    key: "downloads",
    group: "Pages",
    label: "Downloads",
    description: "Brochures, price lists, forms — and the company's apps once they are published.",
    fields: [
      { key: "title", label: "Heading", type: "text", placeholder: "Downloads" },
      { key: "showApps", label: "Show the company's mobile apps", type: "toggle", hint: "Appears once the apps are published (v1.5.0)" },
      { key: "items", label: "Files", type: "list", max: 12, of: [
        { key: "name", label: "Name", type: "text" },
        { key: "url", label: "Link", type: "text" },
      ] },
    ],
  },
  {
    key: "footer",
    group: "Pages",
    label: "Footer & legal",
    description: "The line at the bottom and the links beside it.",
    always: true,
    fields: [
      { key: "text", label: "Footer text", type: "text", placeholder: "© 2026 Company" },
      { key: "links", label: "Links", type: "list", max: 8, of: LINK_ROW },
    ],
  },
  {
    key: "policies",
    group: "Pages",
    label: "Policies & consent",
    description: "The privacy notice, the cookie banner and the DPDP consent link. Switching the banner off does not make the site compliant — it only hides the choice.",
    always: true,
    fields: [
      { key: "showCookieBanner", label: "Show the cookie banner", type: "toggle" },
      { key: "showConsentLink", label: "Link to the DPDP consent notice", type: "toggle" },
      { key: "privacyBody", label: "Privacy policy", type: "richtext", max: 20000, hint: "Left empty, the DPDP notice is shown" },
      { key: "termsBody", label: "Terms", type: "richtext", max: 20000 },
      { key: "refundBody", label: "Refunds / cancellation", type: "richtext", max: 20000 },
    ],
  },
];

export const siteSection = (key: string) => SITE_SECTIONS.find((s) => s.key === key);
export const SITE_GROUPS = ["Site", "Home page", "Pages"] as const;

/** A section is on unless it was switched off; the ones marked `always` cannot be switched off. */
export function sectionOn(site: any, key: string) {
  const def = siteSection(key);
  if (def?.always) return true;
  return site?.sections?.[key]?.on !== false;
}
export const sectionData = (site: any, key: string) => site?.sections?.[key] || {};

/** What a brand-new site starts as, filled in from the company's own details. */
export function startingSite(company: any) {
  const name = company?.branding?.shortName || company?.name || "Company";
  return {
    published: false,
    sections: {
      design: { on: true, theme: "Classic", useBrandColors: true, font: "Plus Jakarta Sans", corners: "Rounded" },
      menu: { on: true, showLogo: true, ctaLabel: "Talk to us", ctaHref: "#enquiry", items: [{ label: "What we do", href: "#services" }, { label: "About", href: "#about" }, { label: "Contact", href: "#contact" }] },
      seo: { on: true, title: name, description: "" },
      announcement: { on: false },
      hero: { on: true, title: name, subtitle: "", button1: "Talk to us", button1Href: "#enquiry", darken: "50%" },
      story: { on: true, title: "Who we are" },
      highlights: { on: true, title: "What we do", items: [] },
      featured: { on: false, fromServices: true, title: "Popular with our customers" },
      offers: { on: false, title: "Offers" },
      testimonials: { on: false, title: "What our customers say" },
      gallery: { on: false, title: "A look around" },
      cta: { on: true, title: "Ready when you are", button: "Send an enquiry", href: "#enquiry" },
      about: { on: true, title: "About us" },
      enquiry: { on: true, title: "Talk to us", askCompany: true, askMessage: true, campaign: "website", thanks: "Thank you — we will be in touch shortly." },
      faq: { on: false, title: "Questions we are asked" },
      contact: { on: true, title: "Find us", address: company?.address || "", phone: company?.phone || "", whatsapp: company?.whatsapp || "", email: company?.email || "" },
      downloads: { on: false, title: "Downloads" },
      footer: { on: true, text: `© ${new Date().getFullYear()} ${name}` },
      policies: { on: true, showCookieBanner: true, showConsentLink: true },
    } as Record<string, any>,
  };
}

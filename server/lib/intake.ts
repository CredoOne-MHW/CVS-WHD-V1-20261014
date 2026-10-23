import { Lead, IntakeEvent, Connector, Company } from "../models";
import { normalizePhone, LEAD_STATUSES } from "../../shared/constants";
import { sha256, decrypt } from "./crypto";
import { fireEvent } from "./whatsapp";
import { shopifyLead, wooLead } from "./shop";

export interface LeadInput {
  name?: string;
  whatsapp?: string;
  phone?: string;
  email?: string;
  address?: string;
  comments?: string;
  status?: string;
  source?: string;
  campaign?: string;
  medium?: string;
  referral?: string;
  profileUrl?: string;
  utm?: Record<string, string>;
  consent?: { whatsapp?: boolean; email?: boolean; text?: string; ip?: string };
  customFields?: Record<string, any>;
}

const ALIASES: Record<keyof LeadInput | string, string[]> = {
  name: ["name", "full_name", "fullname", "customer_name", "patient_name", "first_name", "contact_name", "caller_name"],
  whatsapp: ["whatsapp", "whatsapp_no", "whatsapp_number", "wa", "wa_number", "wa_id"],
  phone: ["phone", "phone_no", "phone_number", "mobile_number", "contact_no", "mobile", "mobile_no", "contact", "contact_number", "caller", "from", "callfrom", "call_from", "caller_id", "msisdn"],
  email: ["email", "e_mail", "email_id", "emailid", "e_mail_id", "email_address", "mail"],
  address: ["address", "city", "location", "area", "pincode"],
  comments: ["comments", "comment", "message", "requirement", "query", "notes", "remarks", "subject", "test_name", "service"],
  source: ["source", "lead_source", "utm_source"],
  campaign: ["campaign", "campaign_name", "utm_campaign", "ad_name", "campaign_id"],
  medium: ["medium", "utm_medium", "channel"],
  referral: ["referral", "referred_by", "referrer", "partner", "partner_code", "affiliate", "ref"],
  status: ["status"],
};

const get = (o: any, path: string) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);
const flatKeys = (o: any) => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o || {})) {
    out[k.toLowerCase().replace(/[\s\-]+/g, "_")] = v;
    // camelCase / PascalCase too: CustomerName → customer_name, LeadId → lead_id (keeps the plain form above)
    const snake = k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s\-]+/g, "_");
    if (!(snake in out)) out[snake] = v;
  }
  return out;
};

/** Field mapping: explicit connector fieldMap first, then common aliases. */
export function mapFields(raw: any, fieldMap: Record<string, string> = {}): LeadInput {
  const flat = flatKeys(raw);
  const out: any = {};
  for (const field of Object.keys(ALIASES)) {
    const mapped = fieldMap[field];
    let v = mapped ? get(raw, mapped) : undefined;
    if (v == null || v === "") v = ALIASES[field].map((a) => flat[a]).find((x) => x != null && x !== "");
    if (v != null && v !== "") out[field] = String(v).trim();
  }
  if (flat.last_name && out.name && !out.name.includes(" ")) out.name = `${out.name} ${flat.last_name}`;
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]) if (flat[k]) utm[k] = String(flat[k]);
  if (Object.keys(utm).length) out.utm = utm;
  const consent = flat.consent ?? flat.whatsapp_consent ?? flat.consent_whatsapp_y_n ?? flat.consent_whatsapp;
  if (consent != null) out.consent = { whatsapp: /^(y|yes|true|1|on)$/i.test(String(consent)), text: flat.consent_text };
  return out;
}

/** Provider adapters → array of LeadInput (one webhook delivery may carry many). Also returns a natural idempotency id. */
export async function adapt(connector: any, payload: any): Promise<{ leads: LeadInput[]; naturalId?: string; ignore?: string }> {
  const fm = connector.fieldMap || {};
  switch (connector.type) {
    case "meta_leads": {
      // Graph webhook: entry[].changes[].value.leadgen_id → fetch via Graph using the page token stored as secret.
      const out: LeadInput[] = [];
      const ids: string[] = [];
      for (const entry of payload?.entry || []) {
        for (const ch of entry.changes || []) {
          const v = ch.value || {};
          ids.push(v.leadgen_id);
          let fieldData = v.field_data;
          const token = decrypt(connector.secretEnc);
          if (!fieldData && v.leadgen_id && token) {
            const r = await fetch(`https://graph.facebook.com/v21.0/${v.leadgen_id}?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10000) });
            if (!r.ok) throw new Error(`Graph API ${r.status}`);
            fieldData = (await r.json()).field_data;
          }
          const obj: any = { campaign: v.campaign_name || v.ad_id || v.form_id, medium: "paid_social" };
          for (const f of fieldData || []) obj[f.name] = Array.isArray(f.values) ? f.values[0] : f.values;
          out.push({ ...mapFields(obj, fm), source: v.platform === "instagram" ? "instagram" : "facebook" });
        }
      }
      if (!out.length && payload?.field_data) out.push(mapFields(Object.fromEntries(payload.field_data.map((f: any) => [f.name, f.values?.[0]])), fm));
      return { leads: out, naturalId: ids.filter(Boolean).join(",") || undefined };
    }
    case "facebook_leads":
    case "instagram_leads": {
      // Sign-in connectors: the lead is fetched with the Page's token (webhook or 15-minute pull) before it gets here.
      // A delivery that couldn't be fetched yet ({ meta_pending }) is fetched on retry.
      const o = await import("./oauth");
      let lead = payload?.meta_lead;
      let page = payload?.page;
      if (!lead && payload?.meta_pending) {
        page = (connector.sso?.pages || []).find((p: any) => p.id === String(payload.meta_pending.page_id));
        const token = decrypt(page?.tokenEnc);
        if (!token) throw new Error("This Page is no longer connected — reconnect the connector");
        lead = await o.metaLead(String(payload.meta_pending.leadgen_id), token);
      }
      if (!lead) return { leads: [], ignore: "No lead in this delivery" };
      const rec = o.metaLeadRecord(lead, page?.name);
      return { leads: [applyMap(mapFields(rec, fm), rec, fm)], naturalId: `fb:${lead.id}` };
    }
    case "linkedin_leads": {
      const rec = payload?.linkedin_lead;
      if (!rec) return { leads: [], ignore: "No lead in this delivery" };
      return { leads: [applyMap({ ...mapFields(rec, fm), profileUrl: rec.profileUrl }, rec, fm)], naturalId: rec._linkedin?.id ? `li:${rec._linkedin.id}` : undefined };
    }
    case "google_sheets": {
      const rec = payload?.sheet_row;
      if (!rec) return { leads: [], ignore: "Empty row" };
      return { leads: [mapFields(rec, fm)] };
    }
    case "google_ads":
      return googleAdsLead(connector, payload);
    case "web_prospect": {
      // Structured by the AI from a public source (see lib/prospect.ts); missing values are already "NA"
      const p = payload?.prospect || {};
      const na = (v: any) => (v == null || v === "" ? "NA" : String(v));
      return {
        leads: [
          applyMap(
            {
              name: na(p.name),
              phone: p.phone || undefined,
              whatsapp: p.whatsapp || undefined,
              email: p.email || undefined,
              profileUrl: p.profileUrl || undefined,
              address: na(p.location),
              comments: [`Looking for: ${na(p.requirement)}`, `Intent: ${na(p.intent)}`, p.quote ? `Said: “${p.quote}”` : "", `Found on: ${p.sourceUrl}`].filter(Boolean).join("\n"),
              campaign: p.keyword || undefined,
              medium: p.sourceKind === "bluesky" ? "bluesky" : p.sourceKind === "web" ? "web search" : "blog / feed",
              referral: p.sourceUrl,
              source: "web_prospect",
              consent: { whatsapp: false, email: false, text: "No consent — collected from a public source. Do not message on WhatsApp without the person's opt-in." },
              customFields: { organisation: na(p.organisation), role: na(p.role), intent: na(p.intent), source_url: p.sourceUrl, source_title: na(p.sourceTitle), captured_at: payload?.capturedAt, legal_basis: "Published by the person on a public page (DPDP Act s.3(c)(ii))" },
            },
            payload,
            fm
          ),
        ],
      };
    }
    case "shopify":
    case "woocommerce": {
      const r = connector.type === "shopify" ? shopifyLead(payload || {}, connector.config) : wooLead(payload || {}, connector.config);
      return { ...r, leads: r.leads.map((l) => applyMap(l, payload, fm)) };
    }
    case "indiamart": {
      const recs = indiamartRecords(payload);
      return { leads: recs.map((r) => indiamartLead(r, fm)), naturalId: recs.map((r) => r.UNIQUE_QUERY_ID).filter(Boolean).join(",") || undefined };
    }
    case "tradeindia": {
      const r = payload || {};
      const f = flatKeys(r);
      const pick = (...k: string[]) => k.map((x) => f[x]).find((v) => v != null && String(v).trim() !== "");
      return {
        leads: [
          applyMap({
            name: pick("sender_name", "sender", "name", "buyer_name"),
            phone: pick("sender_mobile", "mobile", "sender_mobile_no", "phone", "sender_phone"),
            email: pick("sender_email", "email", "sender_email_id"),
            address: [pick("sender_city", "city"), pick("sender_state", "state"), pick("sender_country", "country")].filter(Boolean).join(", ") || undefined,
            comments: [pick("subject"), pick("message", "inquiry_message", "msg"), pick("product_name", "product") && `Product: ${pick("product_name", "product")}`, pick("sender_co", "company", "sender_company") && `Company: ${pick("sender_co", "company", "sender_company")}`].filter(Boolean).join("\n") || undefined,
            campaign: pick("product_name", "product", "subject"),
            medium: pick("inquiry_type", "source") || "marketplace",
            source: "tradeindia",
          }, r, fm),
        ],
        naturalId: pick("rfi_id", "inquiry_id", "id", "rfiid") != null ? `ti:${pick("rfi_id", "inquiry_id", "id", "rfiid")}` : undefined,
      };
    }
    case "justdial": {
      // JustDial pushes one lead per call (usually GET query parameters)
      const f = flatKeys(payload);
      const name = [f.prefix, f.name].filter(Boolean).join(" ").trim() || undefined;
      return {
        leads: [
          applyMap({
            name,
            phone: f.mobile || f.phone,
            whatsapp: f.mobile,
            email: f.email,
            address: [f.area || f.brancharea, f.city, f.pincode].filter(Boolean).join(", ") || undefined,
            comments: [f.category && `Looking for: ${f.category}`, f.company && `Company: ${f.company}`, f.date && `Enquiry: ${f.date} ${f.time || ""}`.trim(), f.phone && f.mobile && f.phone !== f.mobile ? `Alt phone: ${f.phone}` : ""].filter(Boolean).join("\n") || undefined,
            campaign: f.category,
            medium: f.leadtype || "marketplace",
            source: "justdial",
          }, payload, fm),
        ],
        naturalId: f.leadid ? `jd:${f.leadid}` : undefined,
      };
    }
    case "sulekha": {
      // Sulekha's team pushes in their own format — common names are mapped, the rest via Field mapping
      const f = flatKeys(payload);
      const l = mapFields(payload, fm);
      return {
        leads: [{ ...l, comments: l.comments || [f.service_name, f.servicename, f.category, f.locality].filter(Boolean).join(" · ") || undefined, campaign: l.campaign || f.service_name || f.servicename || f.category, source: "sulekha", medium: l.medium || "marketplace" }],
        naturalId: f.leadid || f.lead_id || f.enquiryid || f.enquiry_id ? `su:${f.leadid || f.lead_id || f.enquiryid || f.enquiry_id}` : undefined,
      };
    }
    case "whatsapp": {
      // Meta WhatsApp Cloud API inbound format, or a flat {phone,name,message} from a BSP.
      const out: LeadInput[] = [];
      const ids: string[] = [];
      for (const entry of payload?.entry || [])
        for (const ch of entry.changes || []) {
          const v = ch.value || {};
          const contacts = v.contacts || [];
          for (const msg of v.messages || []) {
            ids.push(msg.id);
            const c = contacts.find((x: any) => x.wa_id === msg.from) || contacts[0];
            out.push({ name: c?.profile?.name, whatsapp: msg.from, phone: msg.from, comments: msg.text?.body || msg.button?.text || `[${msg.type}]`, source: "whatsapp", medium: "chat", referral: msg.referral?.source_url, consent: { whatsapp: true, text: "User-initiated WhatsApp message" } });
          }
        }
      if (!out.length) out.push({ ...mapFields(payload, fm), source: "whatsapp" });
      return { leads: out, naturalId: ids.join(",") || payload?.message_id };
    }
    case "email": {
      const from = String(payload.from || payload.sender || payload.From || "");
      const m = from.match(/^(.*?)\s*<(.+?)>$/);
      const body = String(payload.text || payload["body-plain"] || payload.TextBody || payload.html || "").slice(0, 4000);
      const phoneInBody = body.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/)?.[0];
      return {
        leads: [{ ...mapFields(payload, fm), name: m?.[1]?.replace(/"/g, "") || undefined, email: m?.[2] || from, phone: phoneInBody, comments: `${payload.subject || payload.Subject || ""}\n${body}`.trim(), source: "email", medium: "email" }],
        naturalId: payload["Message-Id"] || payload.MessageID || payload.message_id,
      };
    }
    case "telephony":
      return { leads: [{ ...mapFields(payload, fm), source: "phone_call", medium: payload.CallType || payload.call_type || "call" }], naturalId: payload.CallSid || payload.call_id || payload.uuid };
    default:
      return { leads: [mapFields(payload, fm)], naturalId: payload.lead_id || payload.id || payload.submission_id };
  }
}

/* ───────────── platform mappers ───────────── */
/** Platform defaults first; the company's own Field mapping (if any) wins; empty values dropped. */
function applyMap(lead: any, raw: any, fm: Record<string, string> = {}): LeadInput {
  const out: any = {};
  for (const [k, v] of Object.entries(lead)) if (v != null && v !== "") out[k] = v;
  for (const [field, path] of Object.entries(fm || {})) {
    const v = path ? get(raw, path) : undefined;
    if (v != null && v !== "") out[field] = String(v).trim();
  }
  return out;
}
const IM_TYPES: Record<string, string> = { W: "direct enquiry", B: "buy-lead", P: "PNS call", BIZ: "catalog view", WA: "WhatsApp enquiry" };

/** IndiaMART Push sends {method, url, body: {CODE, STATUS, RESPONSE: {...}}}; Pull returns {RESPONSE: [...]}; accept all shapes. */
export function indiamartRecords(p: any): any[] {
  const r = p?.body?.RESPONSE ?? p?.RESPONSE ?? p?.response ?? p;
  const arr = Array.isArray(r) ? r : r && typeof r === "object" ? [r] : [];
  return arr.filter((x) => x && (x.UNIQUE_QUERY_ID || x.SENDER_MOBILE || x.SENDER_EMAIL));
}
export function indiamartLead(r: any, fm: Record<string, string> = {}): LeadInput {
  const nm = String(r.SENDER_NAME || "").trim();
  return applyMap({
    name: nm && !/^indiamart buyer$/i.test(nm) ? nm : r.SENDER_COMPANY || nm || undefined,
    phone: r.SENDER_MOBILE || r.SENDER_PHONE || undefined,
    whatsapp: r.SENDER_MOBILE || undefined,
    email: r.SENDER_EMAIL || r.SENDER_EMAIL_ALT || undefined,
    address: [r.SENDER_ADDRESS, r.SENDER_CITY, r.SENDER_STATE, r.SENDER_PINCODE].filter(Boolean).join(", ") || undefined,
    comments:
      [
        r.SUBJECT,
        String(r.QUERY_MESSAGE || "").replace(/\\n/g, "\n").replace(/\\t/g, " ").trim(),
        r.QUERY_PRODUCT_NAME && `Product: ${r.QUERY_PRODUCT_NAME}`,
        r.SENDER_COMPANY && `Company: ${r.SENDER_COMPANY}`,
        r.SENDER_MOBILE_ALT && `Alt mobile: ${r.SENDER_MOBILE_ALT}`,
        r.QUERY_TYPE === "P" && r.CALL_DURATION ? `Call duration: ${r.CALL_DURATION}s` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000) || undefined,
    campaign: r.QUERY_PRODUCT_NAME || r.QUERY_MCAT_NAME || undefined,
    medium: IM_TYPES[r.QUERY_TYPE] || r.QUERY_TYPE || "marketplace",
    source: "indiamart",
    customFields: { indiamart_query_id: r.UNIQUE_QUERY_ID, indiamart_type: IM_TYPES[r.QUERY_TYPE] || r.QUERY_TYPE, indiamart_time: r.QUERY_TIME, country: r.SENDER_COUNTRY_ISO },
  }, r, fm);
}

/**
 * Google Ads lead form webhook: { lead_id, user_column_data: [{ column_id, column_name, string_value }], campaign_id, adgroup_id,
 * creative_id, form_id, gcl_id, is_test, google_key }. Standard questions map to lead fields; custom questions go to comments.
 */
const GA_STD: Record<string, keyof LeadInput | "first" | "last" | "skip"> = {
  FULL_NAME: "name", FIRST_NAME: "first", LAST_NAME: "last", EMAIL: "email", WORK_EMAIL: "email", PHONE_NUMBER: "phone", PHONE_NUMBER_VERIFIED: "phone", WORK_PHONE: "phone",
  CITY: "address", REGION: "address", POSTAL_CODE: "address", STREET_ADDRESS: "address", COUNTRY: "address",
};
function googleAdsLead(connector: any, p: any) {
  const out: any = { source: "google_ads", medium: "cpc" };
  const addr: string[] = [];
  const extra: string[] = [];
  let first = "", last = "";
  for (const c of p?.user_column_data || []) {
    const id = String(c.column_id || "").toUpperCase();
    const v = String(c.string_value ?? "").trim();
    if (!v) continue;
    const t = GA_STD[id];
    if (t === "first") first = v;
    else if (t === "last") last = v;
    else if (t === "address") addr.push(v);
    else if (t) out[t] = out[t] || v;
    else extra.push(`${c.column_name || id}: ${v}`); // custom questions (e.g. "Preferred date", "Test required")
  }
  if (!out.name && (first || last)) out.name = `${first} ${last}`.trim();
  if (addr.length) out.address = addr.join(", ");
  const names = connector.config?.campaignNames || {};
  out.campaign = names[String(p.campaign_id)] || connector.defaultCampaign || (p.campaign_id ? `Google Ads campaign ${p.campaign_id}` : undefined);
  out.comments = [p.is_test ? "[Google Ads TEST lead]" : "", ...extra].filter(Boolean).join("\n") || undefined;
  out.utm = Object.fromEntries(Object.entries({ utm_source: "google", utm_medium: "cpc", gclid: p.gcl_id, adgroup_id: p.adgroup_id, creative_id: p.creative_id, form_id: p.form_id, campaign_id: p.campaign_id }).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
  return { leads: [applyMap(out, p, connector.fieldMap || {})], naturalId: p?.lead_id ? `ga:${p.lead_id}` : undefined };
}

function scoreLead(l: any) {
  let s = 0;
  if (l.phone || l.whatsapp) s += 30;
  if (l.email) s += 10;
  if (l.name && l.name !== "NA") s += 10;
  if (l.comments && l.comments.length > 15) s += 15;
  if (l.consent?.whatsapp) s += 10;
  if (["google_ads", "facebook", "instagram", "partner", "referral"].includes(l.source)) s += 10;
  const idx = LEAD_STATUSES.indexOf(l.status);
  if (idx >= 2 && idx <= 7 && l.status !== "Not Interested") s += idx * 3;
  return Math.min(100, s);
}

/**
 * Create a lead or merge into an existing one (same company + same phone/WhatsApp/email).
 * Each touch is appended to attribution history; first touch is kept forever.
 */
export async function upsertLead(companyId: string, input: LeadInput, ctx: { connectorId?: string; by?: string; raw?: any; notify?: boolean } = {}) {
  const phone = input.phone ? normalizePhone(input.phone) : undefined;
  const whatsapp = input.whatsapp ? normalizePhone(input.whatsapp) : phone;
  const email = input.email?.toLowerCase().trim() || undefined;
  const profileUrl = input.profileUrl?.trim() || undefined;
  if (!phone && !whatsapp && !email && !profileUrl) throw new Error("Lead needs at least a phone, WhatsApp number or email");

  const or: any[] = [];
  if (phone) or.push({ phone }, { whatsapp: phone });
  if (whatsapp) or.push({ whatsapp }, { phone: whatsapp });
  if (email) or.push({ email });
  if (profileUrl) or.push({ profileUrl });
  const touch = { at: new Date(), source: input.source || "manual", connectorId: ctx.connectorId, campaign: input.campaign, medium: input.medium, referral: input.referral, utm: input.utm, raw: ctx.raw };

  const existing = await Lead.findOne({ companyId, deletedAt: null, $or: or });
  if (existing) {
    existing.attribution.push(touch);
    for (const f of ["name", "email", "address", "whatsapp", "phone", "profileUrl"] as const) {
      const val = f === "phone" ? phone : f === "whatsapp" ? whatsapp : f === "email" ? email : (input as any)[f];
      if ((!existing[f] || existing[f] === "NA") && val && val !== "NA") existing[f] = val; // "NA" = not known yet
    }
    if (input.comments) existing.comments = [existing.comments, `[${new Date().toLocaleDateString("en-IN")} · ${touch.source}] ${input.comments}`].filter(Boolean).join("\n");
    // never downgrade consent the person already gave (e.g. a public-web touch on an opted-in customer)
    const downgrade = input.consent && ((existing.consent?.whatsapp && input.consent.whatsapp === false) || (existing.consent?.email && input.consent.email === false));
    if (input.consent && !downgrade) existing.consent = { ...existing.consent, ...input.consent, capturedAt: new Date() };
    existing.score = scoreLead(existing);
    await existing.save();
    return { lead: existing, created: false };
  }

  const status = input.status && (LEAD_STATUSES as readonly string[]).includes(input.status) ? input.status : "New";
  const doc: any = {
    companyId,
    name: input.name || "",
    phone,
    whatsapp,
    email,
    address: input.address,
    comments: input.comments,
    source: touch.source,
    campaign: input.campaign,
    medium: input.medium,
    referral: input.referral,
    status,
    consent: input.consent ? { ...input.consent, capturedAt: new Date() } : undefined,
    profileUrl,
    attribution: [touch],
    customFields: input.customFields,
    remarks: [{ by: ctx.by || "system", text: `Lead captured via ${touch.source}`, statusTo: status }],
  };
  doc.score = scoreLead(doc);
  const lead = await Lead.create(doc);

  if (ctx.notify !== false && whatsapp) {
    const company = await Company.findById(companyId).lean<any>();
    fireEvent("company", companyId, "lead_created", {
      phone: whatsapp,
      name: lead.name,
      company: company?.name,
      message: `Hi ${lead.name || "there"}, thank you for contacting ${company?.name || "us"}. Our team will reach out shortly.`,
      params: { lead_id: String(lead._id), source: lead.source },
    }).catch(() => undefined);
  }
  return { lead, created: true };
}

/**
 * Idempotent processing of one inbound delivery.
 * - Same (connector, idemKey) twice → returns the first result without creating anything.
 * - Failures are stored with backoff; /api/cron/retry re-processes them (max 5 attempts).
 */
export async function processIntake(connector: any, payload: any, explicitKey?: string) {
  const { leads, naturalId, ignore } = await adapt(connector, payload).catch((e) => ({ leads: [] as LeadInput[], naturalId: undefined, ignore: undefined, error: e }));
  // Events that are deliberately not leads (a shop's product updates, a checkout without contact details yet, a ping):
  // acknowledged and counted, but not stored or retried.
  if (ignore && !leads.length) {
    await Connector.updateOne({ _id: connector._id }, { $inc: { "stats.ignored": 1 }, $set: { "stats.lastAt": new Date() } });
    return { ok: true, ignored: ignore };
  }
  const idemKey = explicitKey || naturalId || sha256(JSON.stringify(payload));

  let ev;
  try {
    ev = await IntakeEvent.create({ companyId: connector.companyId, connectorId: connector._id, idemKey, payload, status: "processing", attempts: 0 });
  } catch (e: any) {
    if (e?.code === 11000) {
      const prev = await IntakeEvent.findOne({ connectorId: connector._id, idemKey }).lean<any>();
      if (prev?.status === "failed") return runEvent(connector, prev._id, payload); // client retry of a failed delivery
      await Connector.updateOne({ _id: connector._id }, { $inc: { "stats.duplicates": 1 } });
      return { duplicate: true, status: prev?.status, leadId: prev?.leadId };
    }
    throw e;
  }
  return runEvent(connector, ev._id, payload, leads);
}

export async function runEvent(connector: any, eventId: any, payload: any, pre?: LeadInput[]) {
  const ev = await IntakeEvent.findById(eventId);
  try {
    const leads = pre?.length ? pre : (await adapt(connector, payload)).leads;
    if (!leads.length) throw new Error("No lead data found in payload");
    let leadId;
    let created = false;
    for (const l of leads) {
      const r = await upsertLead(String(connector.companyId), { ...l, source: l.source || connector.defaultSource || connector.type, campaign: l.campaign || connector.defaultCampaign, medium: l.medium || connector.defaultMedium }, { connectorId: String(connector._id), raw: payload, by: connector.name, notify: connector.type !== "web_prospect" }); // no WhatsApp to people who never opted in
      leadId = r.lead._id;
      created = created || r.created;
    }
    ev.set({ status: created ? "created" : "merged", leadId, attempts: ev.attempts + 1, error: undefined });
    await ev.save();
    await Connector.updateOne({ _id: connector._id }, { $inc: { "stats.received": 1, [`stats.${created ? "created" : "duplicates"}`]: 1 }, $set: { "stats.lastAt": new Date() } });
    return { ok: true, created, leadId };
  } catch (e: any) {
    const attempts = ev.attempts + 1;
    ev.set({ status: attempts >= 5 ? "dead" : "failed", attempts, error: e?.message, nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** attempts) });
    await ev.save();
    await Connector.updateOne({ _id: connector._id }, { $inc: { "stats.received": 1, "stats.failed": 1 }, $set: { "stats.lastAt": new Date() } });
    return { ok: false, error: e?.message, willRetry: attempts < 5 };
  }
}

import { Lead, IntakeEvent, Connector, Company } from "../models";
import { normalizePhone, LEAD_STATUSES } from "../../shared/constants";
import { sha256, decrypt } from "./crypto";
import { fireEvent } from "./whatsapp";

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
  for (const [k, v] of Object.entries(o || {})) out[k.toLowerCase().replace(/[\s\-]+/g, "_")] = v;
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
export async function adapt(connector: any, payload: any): Promise<{ leads: LeadInput[]; naturalId?: string }> {
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
    case "google_ads": {
      const obj: any = { campaign: payload.campaign_id, medium: "cpc", gclid: payload.gcl_id };
      for (const c of payload.user_column_data || []) obj[String(c.column_id || c.column_name).toLowerCase()] = c.string_value;
      if (obj.full_name) obj.name = obj.full_name;
      if (obj.phone_number) obj.phone = obj.phone_number;
      return { leads: [{ ...mapFields(obj, fm), source: "google_ads" }], naturalId: payload.lead_id };
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

function scoreLead(l: any) {
  let s = 0;
  if (l.phone || l.whatsapp) s += 30;
  if (l.email) s += 10;
  if (l.name) s += 10;
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
  if (!phone && !whatsapp && !email) throw new Error("Lead needs at least a phone, WhatsApp number or email");

  const or: any[] = [];
  if (phone) or.push({ phone }, { whatsapp: phone });
  if (whatsapp) or.push({ whatsapp }, { phone: whatsapp });
  if (email) or.push({ email });
  const touch = { at: new Date(), source: input.source || "manual", connectorId: ctx.connectorId, campaign: input.campaign, medium: input.medium, referral: input.referral, utm: input.utm, raw: ctx.raw };

  const existing = await Lead.findOne({ companyId, deletedAt: null, $or: or });
  if (existing) {
    existing.attribution.push(touch);
    for (const f of ["name", "email", "address", "whatsapp", "phone"] as const) {
      const val = f === "phone" ? phone : f === "whatsapp" ? whatsapp : f === "email" ? email : (input as any)[f];
      if (!existing[f] && val) existing[f] = val;
    }
    if (input.comments) existing.comments = [existing.comments, `[${new Date().toLocaleDateString("en-IN")} · ${touch.source}] ${input.comments}`].filter(Boolean).join("\n");
    if (input.consent) existing.consent = { ...existing.consent, ...input.consent, capturedAt: new Date() };
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
  const { leads, naturalId } = await adapt(connector, payload).catch((e) => ({ leads: [] as LeadInput[], naturalId: undefined, error: e }));
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
      const r = await upsertLead(String(connector.companyId), { ...l, source: l.source || connector.defaultSource || connector.type, campaign: l.campaign || connector.defaultCampaign, medium: l.medium || connector.defaultMedium }, { connectorId: String(connector._id), raw: payload, by: connector.name });
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

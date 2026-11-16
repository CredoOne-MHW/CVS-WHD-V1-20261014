/**
 * Per-company platform settings that Super Admin manages on the company workspace:
 * background jobs, how long each log is kept, in-app notifications, white label and the mobile app shell.
 *
 * Each registry is the single source of truth for its tab — add an entry here and the tab lists it by itself,
 * exactly like the module registry in constants.ts.
 */

/* ───────────────────────── Background jobs (Cron Jobs tab) ───────────────────────── */

export type CronUnit = "minutes" | "hours" | "daily";
export interface CronJobDef {
  key: string; // also the cron route: /api/cron/<route>
  route: string;
  label: string;
  description: string;
  group: "Leads" | "Billing" | "Integration" | "Platform";
  /** every N minutes / hours, or daily at HH:MM IST */
  unit: CronUnit;
  every?: number;
  at?: string; // "HH:MM" when unit is daily
  /** false = runs once for the whole platform; true = the schedule can differ per company */
  perCompany: boolean;
}

export const CRON_JOBS: CronJobDef[] = [
  { key: "jobs", route: "jobs", label: "Background job worker", description: "Imports, exports, WhatsApp redelivery and scheduled AI digests are picked up here.", group: "Platform", unit: "minutes", every: 1, perCompany: false },
  { key: "retry", route: "retry", label: "Retry failed lead deliveries", description: "A lead that could not be saved is tried again once its backoff has elapsed (Integration › Needs attention).", group: "Integration", unit: "minutes", every: 15, perCompany: true },
  { key: "pull_frequent", route: "pull-frequent", label: "Channel pull — frequent", description: "IndiaMART, TradeIndia and WooCommerce safety net, plus the sign-in connectors' 15-minute catch-up.", group: "Integration", unit: "minutes", every: 15, perCompany: false },
  { key: "prospect", route: "prospect", label: "Public web prospecting", description: "Reads each prospecting connector's queue in time-boxed slices.", group: "Leads", unit: "minutes", every: 15, perCompany: false },
  { key: "insights", route: "insights", label: "AI insights digests", description: "Queues the scheduled WhatsApp insight digests.", group: "Leads", unit: "hours", every: 1, perCompany: false },
  { key: "pull", route: "pull", label: "Channel pull — daily", description: "MCP server connectors, once a day.", group: "Integration", unit: "daily", at: "02:00", perCompany: false },
  { key: "billing", route: "billing", label: "Billing day close", description: "Subscription cycles, Unpaid → Over Due → Expired, recurring client dues and reminders.", group: "Billing", unit: "daily", at: "02:00", perCompany: true },
  { key: "followups", route: "followups", label: "Follow-up digest", description: "The morning WhatsApp digest of new leads and follow-ups due today.", group: "Leads", unit: "daily", at: "08:00", perCompany: true },
  { key: "housekeeping", route: "housekeeping", label: "Nightly housekeeping", description: "Deletes log records older than the periods set on the Retention Policy tab.", group: "Platform", unit: "daily", at: "01:00", perCompany: true },
];

export const cronJob = (key: string) => CRON_JOBS.find((j) => j.key === key);

/** A company's override of a job, or the platform default when it has none. */
export interface CronSetting {
  on?: boolean;
  unit?: CronUnit;
  every?: number;
  at?: string;
}
export function cronOf(def: CronJobDef, o?: CronSetting | null) {
  return { on: o?.on !== false, unit: o?.unit || def.unit, every: o?.every ?? def.every ?? 1, at: o?.at || def.at || "02:00" };
}
/** Human text for a schedule — "Every 15 minutes", "Daily at 08:00 IST". */
export function cronText(s: { unit: CronUnit; every: number; at: string }) {
  if (s.unit === "daily") return `Daily at ${s.at} IST`;
  const n = Math.max(1, s.every);
  return n === 1 ? `Every ${s.unit === "hours" ? "hour" : "minute"}` : `Every ${n} ${s.unit}`;
}
/** When a job whose last run was `last` may run again. */
export function cronDue(s: { unit: CronUnit; every: number; at: string }, last?: Date | string | null, now = new Date()) {
  if (!last) return true;
  const prev = new Date(last).getTime();
  if (s.unit === "daily") {
    // IST day boundary at the chosen time
    const [h, m] = s.at.split(":").map(Number);
    const ist = new Date(now.getTime() + 5.5 * 3600_000);
    const target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m) - 5.5 * 3600_000;
    return now.getTime() >= target && prev < target;
  }
  const ms = Math.max(1, s.every) * (s.unit === "hours" ? 3600_000 : 60_000);
  return now.getTime() - prev >= ms - 5_000; // 5 s grace so a one-minute job isn't skipped
}

/* ───────────────────────── Retention (Retention Policy tab) ───────────────────────── */

export interface LogKindDef {
  key: string;
  label: string;
  collection: string;
  where: "tenant" | "main";
  description: string;
  defaultDays: number;
  /** a record this old can never be deleted automatically (0 = no floor) */
  minDays?: number;
  /** the date the period is measured from, when it is not when the record was written */
  dateField?: string;
}

export const LOG_KINDS: LogKindDef[] = [
  { key: "activity_logs", label: "Activity & telemetry", collection: "activitylogs", where: "tenant", description: "Who did what, on every screen.", defaultDays: 365, minDays: 90 },
  { key: "wa_logs", label: "WhatsApp logs", collection: "walogs", where: "tenant", description: "Every webhook delivery, its payload and the provider's reply.", defaultDays: 90, minDays: 30 },
  { key: "intake_events", label: "Lead deliveries", collection: "intakeevents", where: "tenant", description: "Each payload a channel delivered, with its retries.", defaultDays: 90, minDays: 30 },
  { key: "cron_runs", label: "Background job runs", collection: "cronruns", where: "main", description: "When each scheduled job ran, how long it took and what it did.", defaultDays: 30 },
  { key: "jobs", label: "Finished jobs", collection: "jobs", where: "main", description: "Completed imports, exports and digests (dead ones are kept).", defaultDays: 30 },
  { key: "otps", label: "Expired OTPs", collection: "otps", where: "tenant", description: "One-time codes that were used or have expired.", defaultDays: 7 },
  { key: "oauth_states", label: "Sign-in handshakes", collection: "oauthstates", where: "main", description: "Half-finished channel sign-ins.", defaultDays: 7 },
  { key: "dpdp_consents", label: "DPDP consents", collection: "dpdpconsents", where: "tenant", description: "Who accepted the data-protection notice, and the evidence that they read it. Kept for ever unless you say otherwise.", defaultDays: 0, minDays: 365 },
  { key: "cookie_consents", label: "Cookie choices", collection: "cookieconsents", where: "tenant", description: "What each visitor chose in the cookie banner.", defaultDays: 730, minDays: 180 },
  { key: "chat_messages", label: "Chat messages", collection: "chatmessages", where: "tenant", description: "One-to-one and group messages. Kept for ever unless you choose a period — a conversation is a record, not a log.", defaultDays: 0 },
  { key: "push_devices", label: "Dormant phones", collection: "pushdevices", where: "tenant", description: "Phones registered for notifications that have not opened the app for a while.", defaultDays: 180, minDays: 30, dateField: "lastSeenAt" },
];
export const RETAIN_CHOICES = [7, 30, 60, 90, 180, 365, 730, 0]; // 0 = keep for ever
export const retainText = (d: number) => (d === 0 ? "Keep for ever" : d % 365 === 0 ? `${d / 365} year${d > 365 ? "s" : ""}` : `${d} days`);

/* ───────────────────────── In-app notifications (Notifications tab) ───────────────────────── */

export interface NotifyDef {
  key: string;
  label: string;
  description: string;
  group: "Leads" | "Clients" | "Billing" | "Integration" | "System";
  sound: string; // default sound key
}
export const NOTIFY_SOUNDS = ["chime", "bell", "ping", "alert", "none"] as const;
export const NOTIFY_DEVICES = ["mobile", "desktop"] as const;
export type NotifyDevice = (typeof NOTIFY_DEVICES)[number];

export const NOTIFY_KINDS: NotifyDef[] = [
  { key: "lead_new", label: "New lead", description: "A lead arrived from any channel — website, WhatsApp, Meta, Google or a manual entry.", group: "Leads", sound: "chime" },
  { key: "lead_assigned", label: "Lead assigned to me", description: "Someone routed a lead to this user.", group: "Leads", sound: "ping" },
  { key: "followup_due", label: "Follow-up due", description: "A follow-up falls due today and is not yet done.", group: "Leads", sound: "bell" },
  { key: "lead_stale", label: "Lead going cold", description: "A lead has had no activity for longer than the plan's threshold.", group: "Leads", sound: "none" },
  { key: "client_converted", label: "Lead converted to client", description: "A lead reached Converted / Service Initiated.", group: "Clients", sound: "chime" },
  { key: "ticket_new", label: "Support ticket raised", description: "A client raised a ticket from the support page.", group: "Clients", sound: "alert" },
  { key: "payment_due", label: "Invoice due", description: "A client invoice falls due today.", group: "Billing", sound: "bell" },
  { key: "payment_received", label: "Pay-In received", description: "An invoice was marked paid.", group: "Billing", sound: "chime" },
  { key: "subscription_due", label: "Subscription due", description: "The company's own subscription falls due.", group: "Billing", sound: "alert" },
  { key: "intake_failed", label: "Lead delivery failed", description: "A channel delivered a payload that could not be saved (Integration › Needs attention).", group: "Integration", sound: "alert" },
  { key: "connector_down", label: "Channel disconnected", description: "A sign-in connector lost its access and stopped receiving leads.", group: "Integration", sound: "alert" },
  { key: "announcement", label: "Notice from the administrator", description: "The scrolling notice and push messages the admin sends.", group: "System", sound: "ping" },
];

export interface NotifySetting {
  mobile?: boolean;
  desktop?: boolean;
  sound?: string;
}
export const notifyOf = (d: NotifyDef, o?: NotifySetting | null) => ({ mobile: o?.mobile !== false, desktop: o?.desktop !== false, sound: o?.sound || d.sound });

/* ───────────────────────── White label (White label tab) ───────────────────────── */

export const SIDEBAR_STYLES = ["dark", "light"] as const;
export const CORNER_STYLES = ["rounded", "soft", "square"] as const;
export const FONTS = ["Plus Jakarta Sans", "Inter", "Manrope", "Figtree", "Source Sans 3", "IBM Plex Sans"] as const;

export interface WhiteLabel {
  hideBranding?: boolean;
  supportUrl?: string;
  emailSender?: string;
  appNames?: { web?: string; mobile?: string; admin?: string };
  sidebar?: (typeof SIDEBAR_STYLES)[number];
  corners?: (typeof CORNER_STYLES)[number];
  font?: (typeof FONTS)[number];
  customCss?: string;
}

/* ───────────────────────── Company details (Company details tab) ───────────────────────── */

export const BUSINESS_TYPES = ["Diagnostics & Healthcare", "Education", "Real Estate", "Financial Services", "Insurance", "Travel & Hospitality", "Retail & E-commerce", "Manufacturing", "IT & Software", "Professional Services", "Other"];
export const STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Andaman & Nicobar Islands","Chandigarh","Dadra & Nagar Haveli and Daman & Diu","Jammu & Kashmir","Ladakh","Lakshadweep","Puducherry",
];

/* ───────────────────────── S3 layout (per company) ───────────────────────── */

/**
 * Everything a company owns lives under its own prefix, so a company's files can be listed,
 * exported or removed in one place:
 *
 *   <Company Code>/branding/{logo,banner,favicon,app-icon,login-poster}/…
 *   <Company Code>/branding/sounds/<format>/…      notification sounds
 *   <Company Code>/app/<platform>/<version>/…      mobile builds pushed by GitHub Actions
 *   <Company Code>/brain/…                         AI knowledge files
 *   <Company Code>/dpdp/…                          consent documents
 *   <Company Code>/<Client Code>/<type>/…          client attachments
 */
export const S3_AREAS = {
  branding: "branding",
  sounds: "branding/sounds",
  app: "app",
  brain: "brain",
  dpdp: "dpdp",
} as const;
export const s3Area = (code: string, area: keyof typeof S3_AREAS, ...rest: string[]) => [code.toUpperCase(), S3_AREAS[area], ...rest].filter(Boolean).join("/");

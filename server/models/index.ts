import mongoose, { Schema, model, models, type Model } from "mongoose";
import { currentDb } from "../lib/context";
import { LOGIN_TEMPLATE_KEYS } from "../../shared/constants";

const { ObjectId, Mixed } = Schema.Types;
const ts = { timestamps: true };

// Models are typed loosely on purpose: mongoose schema inference is very slow to typecheck.
function m<T = any>(name: string, schema: Schema): Model<T> {
  return (models[name] as Model<T>) || (model(name, schema) as unknown as Model<T>);
}

/**
 * Company-owned data lives in the company's own database (named after its company code).
 * A tenant model resolves, on every call, to the database bound to the current request
 * (see lib/context.ts) — or to the main database when none is bound. One connection pool serves all
 * databases (useDb + useCache), so this adds no connections and no latency.
 */
export const TENANT_MODELS: { name: string; schema: Schema }[] = [];
const tenantCache = new Map<string, Model<any>>();
export function tenantModelFor<T = any>(name: string, db: string | null): Model<T> {
  const base = m<T>(name, TENANT_MODELS.find((x) => x.name === name)!.schema);
  if (!db) return base;
  const k = `${db}\u0000${name}`;
  let M = tenantCache.get(k);
  if (!M) {
    const conn = mongoose.connection.useDb(db, { useCache: true });
    // indexes are created once when the database is provisioned — not on every cold start
    if ((conn as any).get?.("autoIndex") !== false) (conn as any).set?.("autoIndex", false);
    M = (conn.models[name] as Model<any>) || conn.model(name, base.schema);
    tenantCache.set(k, M);
  }
  return M as Model<T>;
}
function tm<T = any>(name: string, schema: Schema): Model<T> {
  TENANT_MODELS.push({ name, schema });
  m(name, schema); // main-database model (Super Admin records + legacy data)
  const resolve = () => tenantModelFor<T>(name, currentDb());
  return new Proxy(function () {} as any, {
    get(_t, prop) {
      const M: any = resolve();
      const v = M[prop];
      return typeof v === "function" ? v.bind(M) : v;
    },
    construct(_t, args) {
      const M: any = resolve();
      return new M(...args);
    },
  }) as Model<T>;
}

/* ───────────────────────── Identity ───────────────────────── */

const UserSchema = new Schema(
  {
    scope: { type: String, enum: ["super", "company"], required: true, index: true },
    companyId: { type: ObjectId, ref: "Company", index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: String,
    passwordHash: { type: String, required: true },
    roleId: { type: ObjectId, ref: "Role" }, // null = owner/full access within plan
    isOwner: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
    tokenVersion: { type: Number, default: 0 }, // bump to revoke all sessions
  },
  ts
);
UserSchema.index({ email: 1 }, { unique: true });
export const User = m<any>("User", UserSchema);

const CompanySchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, uppercase: true, trim: true, unique: true },
    contactPerson: String,
    phone: String,
    whatsapp: String, // 10 digits, no +91
    email: { type: String, required: true, lowercase: true },
    plan: { type: String, default: "Trial", index: true }, // name of a Plan document
    gstin: String,
    address: String,
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    trialEndsAt: Date,
    deletedAt: Date,

    /* White-label: <slug>.<APP_BASE_DOMAIN> and an optional own domain */
    slug: { type: String, lowercase: true, trim: true, unique: true, sparse: true }, // "short name"
    customDomain: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    s3Folder: String, // "<Company-Name>" — fixed at creation; logo/, banner/, brain/ live under it
    dbName: String, // the company's own MongoDB database (= company code at creation; never changes)
    dbReadyAt: Date, // set once the database exists and the company's data lives there
    branding: {
      shortName: String, // display short name, e.g. "Wellness Hive"
      tagline: String, // e.g. "Diagnostic Centre · Polyclinic · Elder Care"
      headline: String, // login hero headline
      subheadline: String, // login hero paragraph
      footerText: String,
      themeColor: { type: String, default: "#2f5c24" },
      accentColor: { type: String, default: "#d9b52a" },
      logoKey: String,
      bannerKey: String,
      faviconKey: String,
      loginLayout: { type: String, enum: ["split", "banner", "centered"], default: "split" },
      loginTemplate: { type: String, enum: [...LOGIN_TEMPLATE_KEYS] }, // one of 10 designs; unset = derived from loginLayout
      supportEmail: String,
      supportPhone: String,
      updatedAt: Date,
    },
    domain: {
      verifyToken: String, // unique TXT value for _credoone-verify.<domain>
      ownershipVerified: Boolean,
      vercelAdded: Boolean,
      verified: Boolean, // ownership verified on Vercel (or no challenge needed)
      configured: Boolean, // DNS points to us and TLS can be issued
      verification: { type: [{ type: { type: String }, domain: String, value: String, reason: String }], default: undefined },
      recommendedIPv4: String,
      recommendedCNAME: String,
      lastCheckedAt: Date,
      lastError: String,
    },
  },
  ts
);
export const Company = m<any>("Company", CompanySchema);

/** One document per plan tier: which company modules + CRUD scope are allowed. */
const PlanSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    description: String,
    priceMonthly: { type: Number, default: 0 },
    leadLimit: { type: Number, default: 0 }, // 0 = unlimited
    userLimit: { type: Number, default: 0 },
    permissions: { type: Mixed, default: {} }, // PermMap
    active: { type: Boolean, default: true },
  },
  ts
);
export const Plan = m<any>("Plan", PlanSchema);

/** Roles: scope=super → SA staff roles; scope=company → roles inside one company (capped by plan). */
const RoleSchema = new Schema(
  {
    scope: { type: String, enum: ["super", "company"], required: true },
    companyId: { type: ObjectId, ref: "Company", index: true },
    name: { type: String, required: true },
    plan: String, // SA-side role templates are defined per plan
    permissions: { type: Mixed, default: {} },
  },
  ts
);
export const Role = tm<any>("Role", RoleSchema);

/* ───────────────────────── Leads ───────────────────────── */

const AttributionSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    source: String,
    connectorId: { type: ObjectId, ref: "Connector" },
    campaign: String,
    medium: String,
    referral: String,
    utm: { type: Mixed },
    raw: { type: Mixed },
  },
  { _id: false }
);

const LeadSchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, default: "" },
    whatsapp: { type: String, index: true },
    phone: { type: String, index: true },
    email: { type: String, lowercase: true },
    address: String,
    comments: String,
    source: { type: String, default: "manual", index: true },
    campaign: String,
    medium: String,
    referral: String,
    profileUrl: String, // public profile / post link (Public Web Prospecting leads without phone or email)
    status: { type: String, default: "New", index: true },
    lostReason: String,
    lostReasonOther: String,
    score: { type: Number, default: 0 },
    nextFollowUpAt: { type: Date, index: true },
    assignedTo: { type: ObjectId, ref: "User" },
    consent: {
      whatsapp: Boolean,
      email: Boolean,
      text: String,
      capturedAt: Date,
      ip: String,
    },
    attribution: { type: [AttributionSchema], default: [] }, // full history, first touch = [0]
    remarks: {
      type: [{ at: { type: Date, default: Date.now }, by: String, text: String, statusFrom: String, statusTo: String }],
      default: [],
    },
    customFields: { type: Mixed, default: {} },
    services: { type: [String], default: undefined }, // from the company's Service master
    business: {
      gst: String,
      tradeLicence: String,
      pan: String,
      registeredAddress: String,
      communicationAddress: String,
      commSameAsRegistered: Boolean,
      ownerEmail: String,
      ownerPhone: String,
      ownerPan: String,
      ownerAadhaarEnc: String, // AES-256-GCM; only the last 4 digits are ever shown
      ownerAadhaarLast4: String,
    },
    // Client module: a lead becomes a client when its status turns "Converted / Service Initiated"
    isClient: Boolean,
    clientCode: String, // e.g. WHD-C0001 — what the client types on the support page
    clientSince: Date,
    serviceStage: String, // Kanban column id
    stageAt: Date,
    deletedAt: Date,
  },
  ts
);
LeadSchema.index({ companyId: 1, createdAt: -1 });
LeadSchema.index({ companyId: 1, isClient: 1, createdAt: -1 });
LeadSchema.index({ companyId: 1, isClient: 1, serviceStage: 1, stageAt: -1 });
LeadSchema.index({ companyId: 1, status: 1, isClient: 1 });
LeadSchema.index({ companyId: 1, clientCode: 1 }, { unique: true, partialFilterExpression: { clientCode: { $type: "string" } } });
LeadSchema.index({ companyId: 1, profileUrl: 1 }, { partialFilterExpression: { profileUrl: { $type: "string" } } });
LeadSchema.index({ companyId: 1, status: 1, updatedAt: -1 });
LeadSchema.index({ name: "text", email: "text", phone: "text", whatsapp: "text", comments: "text" });
export const Lead = tm<any>("Lead", LeadSchema);

/* ───────────────────────── Integrations ───────────────────────── */

const ConnectorSchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", required: true, index: true },
    type: { type: String, required: true },
    name: { type: String, required: true },
    key: { type: String, required: true, unique: true }, // public id used in the intake URL
    secretEnc: String, // HMAC / API key (encrypted)
    verifyToken: String, // Meta verify token
    defaultSource: String,
    defaultCampaign: String,
    defaultMedium: String,
    fieldMap: { type: Mixed, default: {} }, // { name: "full_name", phone: "data.mobile" }
    config: { type: Mixed, default: {} }, // non-secret settings (Google Search keywords, MCP server URL / tool …)
    configSecretEnc: String, // encrypted JSON of secrets (search API key, MCP bearer token …)
    lastRunAt: Date, // pull connectors (Google Search, MCP): last scheduled / manual run
    lastRun: Mixed, // { ok, found, created, duplicates, error }
    pullCursor: Date, // IndiaMART / TradeIndia: end of the last successfully pulled window
    prospect: Mixed, // Public Web Prospecting: { queue, seededAt, workedAt, today, log, lockUntil }
    prospectSeen: { type: [String], default: undefined }, // hashes of pages/posts already read (last 3000)
    active: { type: Boolean, default: true },
    stats: { received: { type: Number, default: 0 }, created: { type: Number, default: 0 }, duplicates: { type: Number, default: 0 }, failed: { type: Number, default: 0 }, ignored: { type: Number, default: 0 }, lastAt: Date },
  },
  ts
);
export const Connector = tm<any>("Connector", ConnectorSchema);

/** Every inbound delivery. Unique (connectorId, idemKey) gives idempotency; failed rows are retried by cron. */
const IntakeEventSchema = new Schema(
  {
    companyId: { type: ObjectId, index: true },
    connectorId: { type: ObjectId, index: true },
    idemKey: { type: String, required: true },
    status: { type: String, enum: ["processing", "created", "merged", "failed", "dead"], default: "processing", index: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: Date,
    leadId: ObjectId,
    error: String,
    payload: Mixed,
  },
  ts
);
IntakeEventSchema.index({ connectorId: 1, idemKey: 1 }, { unique: true });
IntakeEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const IntakeEvent = tm<any>("IntakeEvent", IntakeEventSchema);

/** People removed from Leads who must not be collected again by Public Web Prospecting. Only one-way hashes are kept. */
const SuppressionSchema = new Schema({ hash: { type: String, required: true }, at: { type: Date, default: Date.now } });
SuppressionSchema.index({ hash: 1 }, { unique: true });
export const Suppression = tm<any>("Suppression", SuppressionSchema);

/* ───────────────────────── Clients (Client module) ───────────────────────── */

/** Atomic per-company sequences (client codes, ticket numbers). */
const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = tm<any>("Counter", CounterSchema);

/** Service master: one list per company, used by Leads (Service) and client payments (Service Type). */
const ServiceTypeSchema = new Schema({ companyId: { type: ObjectId, required: true }, name: { type: String, required: true }, key: { type: String, required: true } }, ts);
ServiceTypeSchema.index({ companyId: 1, key: 1 }, { unique: true });
export const ServiceType = tm<any>("ServiceType", ServiceTypeSchema);

/** Kanban columns for the client service journey (editable; one document per company). */
const ClientBoardSchema = new Schema(
  { companyId: { type: ObjectId, required: true }, columns: { type: [{ id: String, name: String, color: String }], default: [] } },
  ts
);
ClientBoardSchema.index({ companyId: 1 }, { unique: true });
export const ClientBoard = tm<any>("ClientBoard", ClientBoardSchema);

export const TICKET_STATUSES = ["Open", "In Progress", "On Hold", "Resolved", "Closed"] as const;
const SupportTicketSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true },
    ticketNo: { type: String, required: true }, // e.g. T-000123
    clientId: { type: ObjectId, required: true }, // the client's lead id
    clientCode: String,
    clientName: String,
    category: { type: String, enum: ["Support", "Request", "Grievance"], required: true },
    description: { type: String, required: true },
    status: { type: String, enum: [...TICKET_STATUSES], default: "Open" },
    via: { type: String, enum: ["portal", "staff"], default: "portal" },
    history: { type: [{ at: { type: Date, default: Date.now }, by: String, from: String, to: String, note: String, notified: Boolean }], default: [] },
    closedAt: Date,
  },
  ts
);
SupportTicketSchema.index({ companyId: 1, ticketNo: 1 }, { unique: true });
SupportTicketSchema.index({ companyId: 1, status: 1, updatedAt: -1 });
SupportTicketSchema.index({ companyId: 1, clientId: 1, createdAt: -1 });
export const SupportTicket = tm<any>("SupportTicket", SupportTicketSchema);

/** Payment Details: what a client pays for which service, recurring (with frequency) or on-demand (price mapping). */
const ClientPlanSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true },
    clientId: { type: ObjectId, required: true },
    clientCode: String,
    clientName: String,
    serviceType: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ["recurring", "on_demand"], required: true },
    frequency: { type: String, enum: ["on_demand", "weekly", "monthly", "quarterly", "half_yearly", "yearly"], required: true },
    startDate: Date, // recurring: first due date
    active: { type: Boolean, default: true },
    lastReminderAt: Date,
  },
  ts
);
ClientPlanSchema.index({ companyId: 1, createdAt: -1 });
ClientPlanSchema.index({ companyId: 1, clientId: 1, serviceType: 1 });
ClientPlanSchema.index({ companyId: 1, type: 1, active: 1 });
export const ClientPlan = tm<any>("ClientPlan", ClientPlanSchema);

/** One payment due / received. Recurring dues are generated from Payment Details; on-demand ones are created by staff. */
const ClientPaymentSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true },
    kind: { type: String, enum: ["recurring", "on_demand"], required: true },
    planId: ObjectId,
    clientId: { type: ObjectId, required: true },
    clientCode: String,
    clientName: String,
    services: { type: [String], default: [] },
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    discountType: { type: String, enum: ["fixed", "percent"], default: "fixed" },
    discountValue: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    gross: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["unpaid", "overdue", "paid"], default: "unpaid" },
    paidAt: Date,
    mode: { type: String, enum: ["NEFT", "CASH", "UPI", "Card", "RTGS"] },
    txnId: String,
    remarks: String,
    lastReminderAt: Date,
  },
  ts
);
ClientPaymentSchema.index({ companyId: 1, kind: 1, status: 1, dueDate: 1 });
ClientPaymentSchema.index({ companyId: 1, status: 1, paidAt: -1 });
ClientPaymentSchema.index({ companyId: 1, clientId: 1, dueDate: -1 });
ClientPaymentSchema.index({ planId: 1, dueDate: 1 }, { unique: true, partialFilterExpression: { planId: { $type: "objectId" } } });
export const ClientPayment = tm<any>("ClientPayment", ClientPaymentSchema);

/* ───────────────────────── WhatsApp ───────────────────────── */

const WebhookSchema = new Schema(
  {
    scope: { type: String, enum: ["super", "company"], required: true },
    companyId: { type: ObjectId, ref: "Company", index: true },
    name: { type: String, required: true },
    event: { type: String, required: true, index: true },
    description: String,
    url: { type: String, required: true },
    method: { type: String, enum: ["POST", "PUT", "PATCH", "GET"], default: "POST" },
    headersEnc: String, // encrypted JSON
    templateName: String,
    singleLine: { type: Boolean, default: true },
    lineSeparator: { type: String, default: " | " },
    maxChars: { type: Number, default: 800 },
    payloadTemplate: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  ts
);
export const Webhook = tm<any>("Webhook", WebhookSchema);

const EventTypeSchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", index: true },
    key: { type: String, required: true },
    label: { type: String, required: true },
    sampleMessage: String,
  },
  ts
);
EventTypeSchema.index({ companyId: 1, key: 1 }, { unique: true });
export const EventType = tm<any>("EventType", EventTypeSchema);

const WaLogSchema = new Schema(
  {
    scope: { type: String, enum: ["super", "company"], index: true },
    companyId: { type: ObjectId, index: true },
    webhookId: ObjectId,
    event: { type: String, index: true },
    trigger: String, // manual | bulk | auto | test | resend | cron
    to: { type: String, index: true },
    name: String,
    result: { type: String, enum: ["success", "failed"], index: true },
    httpStatus: Number,
    detail: String,
    part: String, // "1/3"
    attempts: Number,
    request: Mixed, // { url, method, body }
    response: Mixed,
    triggeredBy: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
WaLogSchema.index({ scope: 1, companyId: 1, createdAt: -1 });
export const WaLog = tm<any>("WaLog", WaLogSchema);

const OtpSchema = new Schema({
  userId: ObjectId,
  purpose: String,
  target: String, // e.g. leadId
  codeHash: String,
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, index: { expires: 0 } },
});
export const Otp = tm<any>("Otp", OtpSchema);

/* ───────────────────────── Activity ───────────────────────── */

const ActivityLogSchema = new Schema(
  {
    scope: { type: String, enum: ["super", "company"], index: true },
    companyId: { type: ObjectId, index: true },
    userId: ObjectId,
    userLabel: String,
    impersonatedBy: String,
    action: String, // Create | Read | Update | Delete | Login | Send …
    module: String,
    item: String,
    response: Number, // HTTP status
    error: String,
    payload: Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ActivityLogSchema.index({ scope: 1, companyId: 1, createdAt: -1 });
ActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });
export const ActivityLog = tm<any>("ActivityLog", ActivityLogSchema);

/* ───────────────────────── AI ───────────────────────── */

/** LLM providers — managed by Super Admin straight from the provider dropdown (add / remove). */
const AiProviderSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    apiStyle: { type: String, enum: ["openai", "anthropic", "google"], default: "openai" }, // wire format
    baseUrl: { type: String, required: true },
    modelsUrl: String, // list endpoint (OpenRouter's is public)
    extraHeaders: { type: Mixed, default: {} }, // e.g. OpenRouter HTTP-Referer / X-Title
    active: { type: Boolean, default: true },
  },
  ts
);
export const AiProvider = m<any>("AiProvider", AiProviderSchema);

/** Platform-level model definitions owned by Super Admin. */
const AiAgentSchema = new Schema(
  {
    name: { type: String, required: true },
    llmVersion: { type: String, required: true }, // e.g. claude-sonnet-5-5, gpt-4.1
    provider: { type: String, required: true }, // AiProvider.key
    url: String, // API base URL
    apiKeyEnc: String,
    tokenWeights: { input: { type: Number, default: 1 }, output: { type: Number, default: 3 } },
    actualRate: { type: Number, default: 0 }, // ₹ per 1k weighted tokens (our cost)
    companyRate: { type: Number, default: 0 }, // ₹ per 1k weighted tokens (billed)
    credits: { type: Number, default: 0 }, // default pool given to each allocated company
    active: { type: Boolean, default: true },
  },
  ts
);
export const AiAgent = m<any>("AiAgent", AiAgentSchema);

/** Credit wallet per company per platform agent. */
const AiAllocationSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true, index: true },
    agentId: { type: ObjectId, required: true },
    credits: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    exhaustedNotifiedAt: Date, // WhatsApp alert sent once per exhaustion; cleared when credits are topped up
    // Allocation (Super Admin › AI Agents › Allocation). Only allocated models are visible to the company.
    allocated: { type: Boolean, default: true },
    startDate: Date,
    frequency: { type: String, enum: ["weekly", "monthly", "quarterly", "half_yearly"], default: "monthly" },
    renewalDate: Date, // credits reset to `credits` and `used` → 0 on this date, then it moves one period on
    lastRenewedAt: Date,
    allocatedBy: String,
    dbName: String, // the only database the AI agent may read for this company (always the company's own)
  },
  ts
);
AiAllocationSchema.index({ companyId: 1, agentId: 1 }, { unique: true });
AiAllocationSchema.index({ renewalDate: 1 });
export const AiAllocation = m<any>("AiAllocation", AiAllocationSchema);

/** Company-built agent on top of a platform agent. */
const CompanyAgentSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true, index: true },
    agentId: { type: ObjectId, ref: "AiAgent", default: null }, // optional until Super Admin allocates a model
    name: { type: String, required: true },
    purpose: String,
    systemPrompt: String,
    prompts: { type: [{ title: String, text: String }], default: [] },
    knowledge: {
      type: [{ fileName: String, key: String, url: String, size: Number, mime: String, chars: Number, extractedKey: String }],
      default: [],
    },
    isAssistant: { type: Boolean, default: false }, // shown as the floating assistant for the whole company
    // Data tables of THIS company the agent may read (report dataset keys). undefined = legacy agent: every table the user can read.
    dataAccess: { type: [String], default: undefined },
    active: { type: Boolean, default: true },
  },
  ts
);
export const CompanyAgent = tm<any>("CompanyAgent", CompanyAgentSchema);

const AiUsageSchema = new Schema(
  {
    companyId: { type: ObjectId, index: true },
    agentId: ObjectId,
    companyAgentId: ObjectId,
    purpose: String, // chat | assistant | report
    userId: ObjectId,
    inputTokens: Number,
    outputTokens: Number,
    weighted: Number,
    credits: Number,
    cost: Number,
    billed: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AiUsageSchema.index({ companyId: 1, createdAt: -1 }); // usage history + per-cycle AI billing
AiUsageSchema.index({ companyAgentId: 1, createdAt: -1 });
export const AiUsage = tm<any>("AiUsage", AiUsageSchema);

/* ───────────────────────── Subscriptions (Super Admin › Settings › Subscription Management) ───────────────────────── */

/** Price list entry: a Plan (from the Plan module) sold at an amount per frequency, with reminder rules. */
const SubscriptionPlanSchema = new Schema(
  {
    planName: { type: String, required: true }, // Plan.name
    amount: { type: Number, required: true, min: 0 },
    frequency: { type: String, enum: ["weekly", "monthly", "quarterly", "half_yearly"], required: true },
    reminderDays: { type: [Number], default: [7, 3, 1] }, // days before the due date
    notifyWebApp: { type: Boolean, default: true },
    notifyWhatsApp: { type: Boolean, default: true },
    webhookId: { type: ObjectId, default: null }, // Super Admin WhatsApp webhook used for reminders (falls back to event "subscription_reminder")
    active: { type: Boolean, default: true },
  },
  ts
);
SubscriptionPlanSchema.index({ planName: 1, frequency: 1 });
export const SubscriptionPlan = m<any>("SubscriptionPlan", SubscriptionPlanSchema);

/** A company's subscription (one active per company). */
const SubscriptionSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true, index: true },
    subscriptionPlanId: { type: ObjectId, required: true },
    planName: String,
    amount: Number, // per cycle, before discount
    frequency: { type: String, enum: ["weekly", "monthly", "quarterly", "half_yearly"] },
    discountType: { type: String, enum: ["flat", "percent"], default: "flat" },
    discountValue: { type: Number, default: 0, min: 0 },
    startDate: { type: Date, required: true },
    active: { type: Boolean, default: true },
    createdBy: String,
  },
  ts
);
SubscriptionSchema.index({ companyId: 1, active: 1 });
export const Subscription = m<any>("Subscription", SubscriptionSchema);

/** One billing cycle (what the Status tab and the company's History list). Due / expiry date = periodEnd. */
const SubscriptionCycleSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true },
    subscriptionId: { type: ObjectId, required: true },
    subscriptionPlanId: ObjectId,
    planName: String,
    frequency: String,
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    systemAmount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    aiAmount: { type: Number, default: null }, // snapshot when the cycle closes; live while open
    status: { type: String, enum: ["unpaid", "paid", "overdue", "expired"], default: "unpaid" },
    statusChangedAt: Date,
    statusChangedBy: String,
    paidAt: Date,
    remindersSent: { type: [Number], default: [] },
    overdueNotifiedAt: Date,
    expiredNotifiedAt: Date,
  },
  ts
);
SubscriptionCycleSchema.index({ subscriptionId: 1, periodStart: 1 }, { unique: true }); // idempotent cycle creation
SubscriptionCycleSchema.index({ companyId: 1, periodStart: -1 });
SubscriptionCycleSchema.index({ status: 1, periodEnd: 1 });
export const SubscriptionCycle = m<any>("SubscriptionCycle", SubscriptionCycleSchema);

/* ───────────────────────── Platform registries (main database) ───────────────────────── */

/** Public connector key → company database (intake URLs carry only the key). */
const ConnectorKeySchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    companyId: { type: ObjectId, required: true, index: true },
    db: { type: String, required: true },
    type: String,
    active: { type: Boolean, default: true },
  },
  ts
);
ConnectorKeySchema.index({ type: 1, active: 1 });
export const ConnectorKey = m<any>("ConnectorKey", ConnectorKeySchema);

/** AI endpoint API key (sha256) → company database + endpoint. The plain key is shown once. */
const EndpointKeySchema = new Schema(
  {
    keyHash: { type: String, required: true, unique: true },
    companyId: { type: ObjectId, required: true, index: true },
    db: { type: String, required: true },
    endpointId: { type: ObjectId, required: true, index: true },
  },
  ts
);
export const EndpointKey = m<any>("EndpointKey", EndpointKeySchema);

/* ───────────────────────── AI endpoints (company database) ───────────────────────── */

/** Company Admin › AI Agent › Endpoint: an HTTPS endpoint external systems call with a user question. */
const AiEndpointSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true, index: true },
    name: { type: String, required: true },
    mode: { type: String, enum: ["agent", "model"], default: "agent" }, // reuse an AI Agent, or a model + instructions
    companyAgentId: { type: ObjectId, default: null },
    agentId: { type: ObjectId, default: null }, // platform model (mode = model)
    instructions: String,
    dataAccess: { type: String, enum: ["none", "aggregate", "full"], default: "aggregate" }, // read-only access to the company database
    keyPrefix: String, // first characters of the key, for display
    allowedOrigins: { type: [String], default: [] }, // browser CORS allow-list ([] = server-to-server only)
    rateLimitPerMin: { type: Number, default: 60 },
    active: { type: Boolean, default: true },
    stats: { calls: { type: Number, default: 0 }, credits: { type: Number, default: 0 }, lastAt: Date },
  },
  ts
);
export const AiEndpoint = tm<any>("AiEndpoint", AiEndpointSchema);

/* ───────────────────────── Platform settings (main database) ───────────────────────── */
/** Small key → value documents, e.g. "platform_branding" (Super Admin › Settings › Platform branding). */
const PlatformSettingSchema = new Schema({ _id: String, value: { type: Mixed, default: {} } }, { timestamps: true });
export const PlatformSetting = m<any>("PlatformSetting", PlatformSettingSchema);

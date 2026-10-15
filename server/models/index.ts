import { Schema, model, models, type Model } from "mongoose";

const { ObjectId, Mixed } = Schema.Types;
const ts = { timestamps: true };

// Models are typed loosely on purpose: mongoose schema inference is very slow to typecheck.
function m<T = any>(name: string, schema: Schema): Model<T> {
  return (models[name] as Model<T>) || (model(name, schema) as unknown as Model<T>);
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
      supportEmail: String,
      supportPhone: String,
      updatedAt: Date,
    },
    domain: {
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
export const Role = m<any>("Role", RoleSchema);

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
    deletedAt: Date,
  },
  ts
);
LeadSchema.index({ companyId: 1, createdAt: -1 });
LeadSchema.index({ companyId: 1, status: 1, updatedAt: -1 });
LeadSchema.index({ name: "text", email: "text", phone: "text", whatsapp: "text", comments: "text" });
export const Lead = m<any>("Lead", LeadSchema);

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
    active: { type: Boolean, default: true },
    stats: { received: { type: Number, default: 0 }, created: { type: Number, default: 0 }, duplicates: { type: Number, default: 0 }, failed: { type: Number, default: 0 }, lastAt: Date },
  },
  ts
);
export const Connector = m<any>("Connector", ConnectorSchema);

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
export const IntakeEvent = m<any>("IntakeEvent", IntakeEventSchema);

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
export const Webhook = m<any>("Webhook", WebhookSchema);

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
export const EventType = m<any>("EventType", EventTypeSchema);

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
export const WaLog = m<any>("WaLog", WaLogSchema);

const OtpSchema = new Schema({
  userId: ObjectId,
  purpose: String,
  target: String, // e.g. leadId
  codeHash: String,
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, index: { expires: 0 } },
});
export const Otp = m<any>("Otp", OtpSchema);

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
export const ActivityLog = m<any>("ActivityLog", ActivityLogSchema);

/* ───────────────────────── AI ───────────────────────── */

/** Platform-level model definitions owned by Super Admin. */
const AiAgentSchema = new Schema(
  {
    name: { type: String, required: true },
    llmVersion: { type: String, required: true }, // e.g. claude-sonnet-5-5, gpt-4.1
    provider: { type: String, enum: ["anthropic", "openai", "google", "openai-compatible"], required: true },
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
  },
  ts
);
AiAllocationSchema.index({ companyId: 1, agentId: 1 }, { unique: true });
export const AiAllocation = m<any>("AiAllocation", AiAllocationSchema);

/** Company-built agent on top of a platform agent. */
const CompanyAgentSchema = new Schema(
  {
    companyId: { type: ObjectId, required: true, index: true },
    agentId: { type: ObjectId, ref: "AiAgent", required: true },
    name: { type: String, required: true },
    purpose: String,
    systemPrompt: String,
    prompts: { type: [{ title: String, text: String }], default: [] },
    knowledge: {
      type: [{ fileName: String, key: String, url: String, size: Number, mime: String, chars: Number, extractedKey: String }],
      default: [],
    },
    active: { type: Boolean, default: true },
  },
  ts
);
export const CompanyAgent = m<any>("CompanyAgent", CompanyAgentSchema);

const AiUsageSchema = new Schema(
  {
    companyId: { type: ObjectId, index: true },
    agentId: ObjectId,
    companyAgentId: ObjectId,
    inputTokens: Number,
    outputTokens: Number,
    weighted: Number,
    credits: Number,
    cost: Number,
    billed: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
export const AiUsage = m<any>("AiUsage", AiUsageSchema);

/**
 * Single source of truth shared by API and UI.
 *
 * COMPANY_MODULES drives: the Company Admin sidebar, the Plan access grid,
 * both Role Management grids and server-side permission checks.
 * Add a module here and it appears everywhere automatically.
 */

export const ACTIONS = ["create", "read", "update", "delete"] as const;
export type Action = (typeof ACTIONS)[number];
export type Perm = Record<Action, boolean>;
export type PermMap = Record<string, Perm>;

export interface ModuleDef {
  key: string;
  label: string;
  group: "Main" | "Settings";
  path: string; // UI route under /app
  icon: string; // lucide icon name
}

export const COMPANY_MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", group: "Main", path: "/app", icon: "LayoutDashboard" },
  { key: "leads", label: "Leads", group: "Main", path: "/app/leads", icon: "Users" },
  { key: "integrations", label: "Integration", group: "Main", path: "/app/integrations", icon: "PlugZap" },
  { key: "reports", label: "Report", group: "Main", path: "/app/reports", icon: "BarChart3" },
  { key: "roles", label: "Role Management", group: "Settings", path: "/app/settings/roles", icon: "ShieldCheck" },
  { key: "activity_logs", label: "Activity Logs", group: "Settings", path: "/app/settings/activity-logs", icon: "ScrollText" },
  { key: "wa_webhooks", label: "WhatsApp Webhook", group: "Settings", path: "/app/settings/whatsapp", icon: "Webhook" },
  { key: "wa_logs", label: "WhatsApp Logs", group: "Settings", path: "/app/settings/whatsapp-logs", icon: "MessagesSquare" },
  { key: "ai_agents", label: "AI Agent", group: "Settings", path: "/app/settings/ai-agents", icon: "Bot" },
  { key: "subscription", label: "Subscription", group: "Settings", path: "/app/settings/subscription", icon: "CreditCard" },
];

export const SA_MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", group: "Main", path: "/sa", icon: "LayoutDashboard" },
  { key: "companies", label: "Company", group: "Main", path: "/sa/companies", icon: "Building2" },
  { key: "ai_agents", label: "AI Agents", group: "Main", path: "/sa/ai-agents", icon: "Bot" },
  { key: "plans", label: "Plan", group: "Main", path: "/sa/plans", icon: "Layers" },
  { key: "reports", label: "Report", group: "Main", path: "/sa/reports", icon: "BarChart3" },
  { key: "knowledgebase", label: "Knowledgebase", group: "Main", path: "/sa/knowledgebase", icon: "BookOpenText" },
  { key: "roles", label: "Role Management", group: "Settings", path: "/sa/settings/roles", icon: "ShieldCheck" },
  { key: "activity_logs", label: "Activity Logs", group: "Settings", path: "/sa/settings/activity-logs", icon: "ScrollText" },
  { key: "wa_webhooks", label: "WhatsApp Webhook", group: "Settings", path: "/sa/settings/whatsapp", icon: "Webhook" },
  { key: "wa_logs", label: "WhatsApp Logs", group: "Settings", path: "/sa/settings/whatsapp-logs", icon: "MessagesSquare" },
  { key: "subscriptions", label: "Subscription Management", group: "Settings", path: "/sa/settings/subscriptions", icon: "CreditCard" },
];

export const PLAN_TIERS = ["Trial", "Standard", "Pro", "Enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const LEAD_STATUSES = [
  "New",
  "Contact Attempted",
  "Interested",
  "Not Interested",
  "Requirement Identified",
  "Price / Package Shared",
  "Appointment Booked",
  "Converted / Service Initiated",
  "Follow-ups needed",
  "Lost / Not Converted",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LOST_STATUS: LeadStatus = "Lost / Not Converted";
export const WON_STATUS: LeadStatus = "Converted / Service Initiated";

export const LOST_REASONS = [
  "Price too high",
  "Chose another diagnostic center",
  "Appointment unavailable",
  "Home collection unavailable",
  "Patient postponed",
  "Patient not reachable",
  "Inquiry only / no immediate requirement",
  "Duplicate inquiry",
  "Other",
] as const;

export interface ConnectorDef {
  type: string;
  label: string;
  description: string;
  icon: string;
  inbound: "webhook" | "upload" | "manual" | "meta" | "google" | "pull" | "push" | "push_pull";
}

export const CONNECTOR_TYPES: ConnectorDef[] = [
  { type: "website_form", label: "Website / Landing Page Form", description: "POST form submissions from any site or landing page.", icon: "Globe", inbound: "webhook" },
  { type: "manual", label: "Manual Entry", description: "Add leads by hand from the Leads screen.", icon: "PencilLine", inbound: "manual" },
  { type: "bulk_import", label: "Excel / CSV Import", description: "Upload .xlsx or .csv using the sample template.", icon: "FileSpreadsheet", inbound: "upload" },
  { type: "rest_api", label: "REST API / Webhook", description: "Generic JSON endpoint. Create as many as you need.", icon: "Braces", inbound: "webhook" },
  { type: "whatsapp", label: "WhatsApp Business Platform", description: "Inbound messages from your WhatsApp Cloud API / BSP.", icon: "MessageCircle", inbound: "webhook" },
  { type: "meta_leads", label: "Facebook & Instagram Lead Forms", description: "Meta Lead Ads webhook (leadgen) with verify token.", icon: "Facebook", inbound: "meta" },
  { type: "google_ads", label: "Google Ads Lead Forms", description: "People who searched your keywords on Google and filled your lead form — delivered instantly.", icon: "Search", inbound: "google" },
  { type: "email", label: "Email Inquiries", description: "Inbound-parse webhook (SendGrid, Mailgun, Postmark).", icon: "Mail", inbound: "webhook" },
  { type: "telephony", label: "Telephone / Call Center", description: "Missed-call & IVR webhooks (Exotel, Knowlarity, Ozonetel…).", icon: "PhoneCall", inbound: "webhook" },
  { type: "qr_campaign", label: "QR Code & Campaign Form", description: "Hosted form per campaign with a printable QR code.", icon: "QrCode", inbound: "webhook" },
  { type: "partner", label: "Partner / Referral / Affiliate", description: "Per-partner keys so every lead is credited correctly.", icon: "Handshake", inbound: "webhook" },
  { type: "indiamart", label: "IndiaMART", description: "Buyer enquiries, buy-leads, PNS calls & WhatsApp enquiries — instant Push API + 15-minute Pull API.", icon: "Store", inbound: "push_pull" },
  { type: "justdial", label: "JustDial", description: "Every JustDial enquiry pushed to your own lead URL in real time.", icon: "PhoneIncoming", inbound: "push" },
  { type: "tradeindia", label: "TradeIndia", description: "Buyer inquiries pulled every 15 minutes from the My Inquiry API.", icon: "Building", inbound: "pull" },
  { type: "sulekha", label: "Sulekha", description: "Service enquiries pushed by Sulekha to your own lead URL.", icon: "BadgeCheck", inbound: "push" },
  { type: "shopify", label: "Shopify", description: "Abandoned checkouts, new customers and orders from your Shopify store — instant, signed webhooks.", icon: "ShoppingBag", inbound: "push" },
  { type: "woocommerce", label: "WooCommerce", description: "Orders and new customers from your WordPress shop — signed webhooks + 15-minute safety-net fetch.", icon: "ShoppingCart", inbound: "push_pull" },
  { type: "mcp", label: "MCP Server (Zapier, Make, HubSpot…)", description: "Pull leads daily from any MCP server tool — CRMs, sheets, forms.", icon: "Cable", inbound: "pull" },
];

/** Built-in WhatsApp webhook events. Companies can add their own types. */
export const SA_EVENTS = [
  { key: "company_reminder", label: "Company reminder (Company → Reminder)" },
  { key: "company_created", label: "Company created (welcome)" },
  { key: "company_deactivated", label: "Company deactivated" },
  { key: "credits_low", label: "AI credits exhausted (company)" },
  { key: "subscription_reminder", label: "Subscription payment reminder (1 / 3 / 7 days prior)" },
  { key: "subscription_overdue", label: "Subscription payment over due" },
  { key: "subscription_expired", label: "Subscription expired (30 days over due)" },
];
export const COMPANY_SYSTEM_EVENTS = [
  { key: "lead_reminder", label: "Lead reminder (Lead → Reminder)" },
  { key: "lead_created", label: "New lead captured" },
  { key: "lead_status_changed", label: "Lead status changed" },
  { key: "followup_digest", label: "Daily follow-up digest" },
  { key: "delete_otp", label: "Delete OTP (verification)" },
  { key: "broadcast", label: "Post / broadcast" },
  { key: "ai_credits_exhausted", label: "AI credits exhausted (to admin)" },
];

export const PLACEHOLDERS = [
  "event", "template", "to", "phone", "name", "company", "message", "message_raw", "params",
];

export const DEFAULT_PAYLOAD_TEMPLATE = `{
  "event": "{{event}}",
  "template": "{{template}}",
  "to": "{{to}}",
  "phone": "{{phone}}",
  "message": "{{message}}",
  "params": {{params}}
}`;

export function fullPerm(): Perm {
  return { create: true, read: true, update: true, delete: true };
}
export function noPerm(): Perm {
  return { create: false, read: false, update: false, delete: false };
}
export function normalizePhone(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d.slice(-10);
}

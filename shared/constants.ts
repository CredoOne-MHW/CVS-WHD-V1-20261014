import { eventsFor } from "./events";
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

/**
 * A part of a module (a tab or a distinct action) that roles can allow separately. Its permission key is
 * "<module>:<sub>" (a colon: MongoDB keys can’t hold dots) (e.g. "clients:invoice"). Only the listed actions apply; a role that doesn't set a sub-module
 * inherits the module's own permission — so adding a sub-module here never takes access away from existing roles.
 */
export interface SubModuleDef {
  key: string;
  label: string;
  actions: Action[];
}
export interface ModuleDef {
  key: string;
  label: string;
  group: "Main" | "Settings";
  path: string; // UI route under /app
  icon: string; // lucide icon name
  subs?: SubModuleDef[]; // listed automatically in Role Management
}


const CRUD: Action[] = ["create", "read", "update", "delete"];

export const COMPANY_MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", group: "Main", path: "/app", icon: "LayoutDashboard" },
  {
    key: "leads", label: "Leads", group: "Main", path: "/app/leads", icon: "Users",
    subs: [
      { key: "import", label: "Import (Excel / CSV)", actions: ["create"] },
      { key: "export", label: "Export", actions: ["read"] },
      { key: "bulk", label: "Bulk status update", actions: ["update"] },
    ],
  },
  {
    key: "clients", label: "Client", group: "Main", path: "/app/clients", icon: "Briefcase",
    subs: [
      { key: "clients", label: "Clients", actions: ["read", "update"] },
      { key: "board", label: "Service Board", actions: ["read", "update"] },
      { key: "tickets", label: "Support Tickets", actions: CRUD },
      { key: "sales_order", label: "Sales Order", actions: CRUD },
      { key: "invoice", label: "Invoice", actions: CRUD },
      { key: "payin", label: "Pay-In", actions: ["read", "update", "delete"] },
    ],
  },
  { key: "integrations", label: "Integration", group: "Main", path: "/app/integrations", icon: "PlugZap" },
  {
    key: "reports", label: "Report", group: "Main", path: "/app/reports", icon: "BarChart3",
    subs: [
      { key: "builder", label: "Report builder", actions: ["read"] },
      { key: "ai", label: "AI reports", actions: ["read"] },
      { key: "export", label: "Download (Excel / CSV)", actions: ["read"] },
    ],
  },
  {
    key: "roles", label: "Role Management", group: "Settings", path: "/app/settings/roles", icon: "ShieldCheck",
    subs: [
      { key: "roles", label: "Roles", actions: CRUD },
      { key: "users", label: "Users", actions: CRUD },
    ],
  },
  { key: "activity_logs", label: "Activity Logs", group: "Settings", path: "/app/settings/activity-logs", icon: "ScrollText" },
  {
    key: "wa_webhooks", label: "WhatsApp Webhook", group: "Settings", path: "/app/settings/whatsapp", icon: "Webhook",
    subs: [
      { key: "webhooks", label: "Webhooks", actions: CRUD },
      { key: "post", label: "Post / broadcast", actions: ["create"] },
    ],
  },
  { key: "wa_logs", label: "WhatsApp Logs", group: "Settings", path: "/app/settings/whatsapp-logs", icon: "MessagesSquare" },
  {
    key: "ai_agents", label: "AI Agent", group: "Settings", path: "/app/settings/ai-agents", icon: "Bot",
    subs: [
      { key: "models", label: "Models", actions: CRUD },
      { key: "endpoint", label: "Endpoint", actions: CRUD },
    ],
  },
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
  { key: "branding", label: "Platform Branding", group: "Settings", path: "/sa/settings/branding", icon: "Palette" },
  { key: "system", label: "System Health", group: "Settings", path: "/sa/settings/system", icon: "Activity" },
];

/** Login page designs (rendered by src/components/LoginTemplates.tsx). */
export const LOGIN_TEMPLATE_KEYS = ["classic", "photo", "spotlight", "aurora", "cinema", "orbit", "depth", "funnel", "minimal", "editorial", "mesh", "noir", "showcase", "glass"] as const;

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
  { type: "web_prospect", label: "Public Web Prospecting", description: "Daily 2 AM: people who publicly asked for what you offer — web & blogs, feeds, Bluesky — structured by AI. Test Now included.", icon: "Radar", inbound: "pull" },
  { type: "mcp", label: "MCP Server (Zapier, Make, HubSpot…)", description: "Pull leads daily from any MCP server tool — CRMs, sheets, forms.", icon: "Cable", inbound: "pull" },
];

/** Built-in WhatsApp webhook events — derived from the single registry in shared/events.ts. Companies can add their own types. */
export const SA_EVENTS = eventsFor("super").map(({ key, label }) => ({ key, label }));
export const COMPANY_SYSTEM_EVENTS = eventsFor("company").map(({ key, label }) => ({ key, label }));

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

/** Module + sub-module rows for permission grids ("clients", "clients:invoice", …), in display order. */
export function permRows(modules: ModuleDef[]) {
  const out: { key: string; label: string; group?: string; parent?: string; actions?: Action[] }[] = [];
  for (const m of modules) {
    out.push({ key: m.key, label: m.label, group: m.group });
    for (const s of m.subs || []) out.push({ key: `${m.key}:${s.key}`, label: s.label, parent: m.key, actions: s.actions });
  }
  return out;
}

/** Effective sub-module permissions: the module's permission ∧ the sub-module's applicable actions ∧ the role's choice (if any). */
export function withSubPerms(modules: ModuleDef[], perms: PermMap, rolePerms?: PermMap | null): PermMap {
  const out: PermMap = { ...perms };
  for (const m of modules)
    for (const s of m.subs || []) {
      const k = `${m.key}:${s.key}`;
      const own = rolePerms?.[k];
      out[k] = Object.fromEntries(ACTIONS.map((a) => [a, s.actions.includes(a) && !!perms[m.key]?.[a] && (own ? !!own[a] : true)])) as Perm;
    }
  return out;
}

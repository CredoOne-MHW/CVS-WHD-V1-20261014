/**
 * WhatsApp Webhook events — the ONE source of truth.
 *
 * Every event the app can send lives here. The Settings › WhatsApp Webhook dropdown (Super Admin and Company) is served
 * from this list by the API, so it changes with every deployment automatically:
 *   • add an event  → add it here and fire it with fireEvent() — it appears in the dropdown on the next deploy;
 *   • remove one    → delete its fireEvent() call and its entry here — it disappears from the dropdown.
 * Two guards keep this list honest:
 *   • TypeScript: fireEvent() only accepts keys from this list (a typo or unregistered event fails the build);
 *   • `npm run check:events` (runs before every build): fails if an entry here is never fired anywhere in the code.
 */

export type EventScope = "super" | "company";

export interface WaEventDef {
  key: string;
  scope: EventScope;
  group: string;
  label: string;
  /** who receives the message */
  to: string;
  description: string;
  /** keys available as {{params.<key>}} in the payload template */
  params: readonly string[];
  /** company module the event belongs to (hidden from companies whose plan doesn't include it) */
  module?: string;
  /** sent only on demand from a screen (e.g. Post / broadcast) rather than by fireEvent() */
  manual?: boolean;
}

export const WA_EVENTS = [
  /* ───────────── Company › Leads ───────────── */
  { key: "lead_created", scope: "company", group: "Leads", label: "New lead captured", to: "Lead", module: "leads", description: "A lead arrives from any source (form, integration, import, manual).", params: ["lead_id", "source"] },
  { key: "lead_status_changed", scope: "company", group: "Leads", label: "Lead status changed", to: "Lead", module: "leads", description: "A lead's status changes (single or bulk update).", params: ["status", "previous"] },
  { key: "lead_reminder", scope: "company", group: "Leads", label: "Lead reminder (Lead → Reminder)", to: "Lead", module: "leads", description: "Sent when staff press Reminder on a lead.", params: ["lead_id", "status"] },
  { key: "followup_digest", scope: "company", group: "Leads", label: "Daily follow-up digest", to: "Company admin", module: "leads", description: "Morning summary of new leads and follow-ups due today.", params: ["new", "due"] },
  { key: "delete_otp", scope: "company", group: "Leads", label: "Delete OTP (verification)", to: "Company admin", module: "leads", description: "One-time code to confirm deleting leads.", params: ["otp"] },

  /* ───────────── Company › Client ───────────── */
  { key: "client_created", scope: "company", group: "Client", label: "Lead converted to client (welcome + Client ID)", to: "Client", module: "clients", description: "A lead becomes a client (status “Converted / Service Initiated”). Includes the Client ID and support page link.", params: ["client_id", "support_url"] },
  { key: "client_stage_changed", scope: "company", group: "Client", label: "Client service status changed (Service Board)", to: "Client", module: "clients", description: "A client card moves to another Service Board column.", params: ["client_id", "stage", "previous"] },
  { key: "support_ticket_created", scope: "company", group: "Client", label: "Support ticket created", to: "Client", module: "clients", description: "A ticket is raised on the support page or by staff.", params: ["ticket_no", "status", "category", "client_id", "note"] },
  { key: "support_ticket_updated", scope: "company", group: "Client", label: "Support ticket status update", to: "Client", module: "clients", description: "A ticket's status changes.", params: ["ticket_no", "status", "category", "client_id", "note"] },
  { key: "client_payment_reminder", scope: "company", group: "Client", label: "Client payment reminder", to: "Client", module: "clients", description: "Reminder for a due invoice (Client › Subscription Management › Invoice › Reminder).", params: ["client_id", "amount", "due_date", "service"] },
  { key: "client_payment_received", scope: "company", group: "Client", label: "Client payment received (receipt)", to: "Client", module: "clients", description: "An invoice is marked Paid (moves to Pay-In).", params: ["client_id", "amount", "mode", "txn_id", "paid_on"] },
  { key: "client_payment_overdue", scope: "company", group: "Client", label: "Client payment over due", to: "Client", module: "clients", description: "An unpaid client payment passes its due date (sent once).", params: ["client_id", "amount", "due_date"] },

  /* ───────────── Company › Team, AI, messaging ───────────── */
  { key: "user_created", scope: "company", group: "Team", label: "New team member added (login details)", to: "Staff user", module: "roles", description: "A user is added in Role Management (no password is sent).", params: ["email", "role", "login_url"] },
  { key: "ai_insights", scope: "company", group: "AI", label: "AI insights & recommendations (dashboard digest)", to: "Company admin", module: "dashboard", description: "Health score, what needs attention, what goes well and AI recommendations from live data — on a daily / weekly schedule (set below) or from Dashboard › Share on WhatsApp.", params: ["health_score", "health", "leads", "conversion", "collected", "overdue", "alerts"] },
  { key: "ai_credits_exhausted", scope: "company", group: "AI", label: "AI credits exhausted", to: "Company admin", module: "ai_agents", description: "An AI agent's model runs out of credits.", params: ["agent", "credits"] },
  { key: "broadcast", scope: "company", group: "Messaging", label: "Post / broadcast", to: "Selected leads", module: "wa_webhooks", description: "Messages sent from WhatsApp Webhook › Post.", params: ["lead_id"], manual: true },

  /* ───────────── Super Admin › Companies ───────────── */
  { key: "company_created", scope: "super", group: "Companies", label: "Company created (welcome)", to: "Company contact", description: "A new company workspace is created.", params: ["plan", "code"] },
  { key: "company_activated", scope: "super", group: "Companies", label: "Company activated", to: "Company contact", description: "A deactivated company is switched back on.", params: ["code"] },
  { key: "company_deactivated", scope: "super", group: "Companies", label: "Company deactivated", to: "Company contact", description: "A company is deactivated (its users are signed out).", params: ["code"] },
  { key: "company_reminder", scope: "super", group: "Companies", label: "Company reminder (Company → Reminder)", to: "Company contact", description: "Sent when Super Admin presses Reminder on a company.", params: ["plan", "code"] },
  { key: "credits_low", scope: "super", group: "AI", label: "AI credits exhausted (company)", to: "Company contact", description: "A company's AI model credits run out.", params: ["agent", "credits"] },

  /* ───────────── Super Admin › Subscriptions ───────────── */
  { key: "subscription_reminder", scope: "super", group: "Subscriptions", label: "Subscription payment reminder (1 / 3 / 7 days prior)", to: "Company contact", description: "Before a subscription payment is due.", params: ["plan", "amount", "due_date", "status"] },
  { key: "subscription_overdue", scope: "super", group: "Subscriptions", label: "Subscription payment over due", to: "Company contact", description: "A subscription payment passes its due date.", params: ["plan", "amount", "due_date", "status"] },
  { key: "subscription_expired", scope: "super", group: "Subscriptions", label: "Subscription expired (30 days over due)", to: "Company contact", description: "Still unpaid 30 days after the due date.", params: ["plan", "amount", "due_date", "status"] },
  { key: "subscription_paid", scope: "super", group: "Subscriptions", label: "Subscription payment received (receipt)", to: "Company contact", description: "A subscription payment is marked Paid.", params: ["plan", "amount", "due_date", "status"] },
] as const satisfies readonly WaEventDef[];

type Ev = (typeof WA_EVENTS)[number];
export type SaEventKey = Extract<Ev, { scope: "super" }>["key"];
export type CompanyEventKey = Extract<Ev, { scope: "company" }>["key"];
export type EventKey<S extends EventScope> = S extends "super" ? SaEventKey : CompanyEventKey;

export const eventsFor = (scope: EventScope) => (WA_EVENTS as readonly WaEventDef[]).filter((e) => e.scope === scope);
export const isSystemEvent = (scope: EventScope, key: string) => eventsFor(scope).some((e) => e.key === key);

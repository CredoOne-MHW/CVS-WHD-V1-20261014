/**
 * Shopify & WooCommerce → leads.
 * Who becomes a lead (each can be switched off per connector in Settings → "Capture"):
 *  - checkouts: abandoned checkouts (Shopify) — a shopper typed their contact details but didn't pay; the best sales lead a shop has
 *  - customers: new customer accounts / sign-ups
 *  - orders:    purchases (paid orders can start as "Converted"; unpaid / pending ones stay "New" so the team can follow up)
 * The same person across events merges into one lead (phone / email), with each event added to the lead's history.
 */
import type { LeadInput } from "./intake";
import { WON_STATUS } from "../../shared/constants";

export type ShopEvent = "checkouts" | "customers" | "orders";
export const SHOP_EVENTS: ShopEvent[] = ["checkouts", "customers", "orders"];
type Adapted = { leads: LeadInput[]; naturalId?: string; ignore?: string };

const s = (v: any) => (v == null ? "" : String(v).trim());
const joinName = (...parts: any[]) => parts.map(s).filter(Boolean).join(" ") || undefined;
const money = (amount: any, currency?: string) => {
  const n = Number(amount);
  if (!isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency || ""} ${n.toFixed(2)}`.trim();
  }
};
const place = (a: any) => (a ? [a.city, a.province || a.state, a.zip || a.postcode, a.country].map(s).filter(Boolean).join(", ") || undefined : undefined);
const street = (a: any) => (a ? [a.address1 || a.address_1, a.address2 || a.address_2].map(s).filter(Boolean).join(", ") : "");
const items = (li: any[] | undefined) =>
  (li || [])
    .slice(0, 10)
    .map((i) => `${s(i.title || i.name)}${i.variant_title ? ` (${s(i.variant_title)})` : ""}${Number(i.quantity) > 1 ? ` ×${i.quantity}` : ""}`)
    .filter(Boolean)
    .join(", ");
function utmFrom(url: any): Record<string, string> | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(String(url), "https://x.invalid");
    const out: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]) {
      const v = u.searchParams.get(k);
      if (v) out[k] = v.slice(0, 200);
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}
const enabled = (cfg: any, e: ShopEvent) => !Array.isArray(cfg?.events) || cfg.events.includes(e);
const finish = (lead: LeadInput): LeadInput => {
  const out: any = {};
  for (const [k, v] of Object.entries(lead)) if (v != null && v !== "") out[k] = v;
  return out;
};

/* ─────────────── Shopify ─────────────── */

/** Topic comes from the X-Shopify-Topic header (stored on the payload as `_topic`); inferred if missing. */
function shopifyKind(p: any): ShopEvent | null {
  const t = s(p._topic).toLowerCase();
  if (t.startsWith("orders/")) return t === "orders/create" || t === "orders/paid" ? "orders" : null;
  if (t.startsWith("checkouts/")) return "checkouts";
  if (t.startsWith("customers/")) return t === "customers/create" ? "customers" : null;
  if (t) return null; // products/…, app/uninstalled etc.
  if (p.order_number != null || p.financial_status) return "orders";
  if (p.abandoned_checkout_url || p.cart_token) return "checkouts";
  if (p.email != null || p.first_name != null) return "customers";
  return null;
}

export function shopifyLead(p: any, cfg: any = {}): Adapted {
  const kind = shopifyKind(p);
  if (!kind) return { leads: [], ignore: `Shopify event ${p._topic || "(unknown)"} is not used for leads` };
  if (!enabled(cfg, kind)) return { leads: [], ignore: `Capturing ${kind} is switched off in Settings` };
  const cust = kind === "customers" ? p : p.customer || {};
  const bill = p.billing_address || {};
  const ship = p.shipping_address || {};
  const addr = kind === "customers" ? p.default_address || (p.addresses || [])[0] || {} : ship.city ? ship : bill;
  const email = s(p.email || p.contact_email || cust.email);
  const phone = s(p.phone || cust.phone || bill.phone || ship.phone || addr.phone);
  if (!email && !phone) return { leads: [], ignore: "No email or phone yet (Shopify sends the checkout again once the shopper enters them)" };
  const name = joinName(cust.first_name, cust.last_name) || s(bill.name) || s(ship.name) || joinName(addr.first_name, addr.last_name);
  const total = money(p.total_price ?? p.subtotal_price, p.currency || p.presentment_currency);
  const products = items(p.line_items);
  const utm = utmFrom(p.landing_site);
  const test = p.test === true ? "[Shopify TEST] " : "";
  let comments = "";
  let medium = "";
  let status: string | undefined;
  let naturalId = "";
  if (kind === "orders") {
    if (p.cancelled_at) return { leads: [], ignore: "Cancelled order" };
    const paid = ["paid", "partially_paid"].includes(s(p.financial_status));
    medium = paid ? "order" : "unpaid order";
    comments = `${test}Order ${s(p.name) || `#${s(p.order_number)}`} · ${total}${p.financial_status ? ` · ${s(p.financial_status).replace(/_/g, " ")}` : ""}${products ? `\nItems: ${products}` : ""}${p.note ? `\nNote: ${s(p.note).slice(0, 500)}` : ""}`;
    if (paid && cfg.ordersAsConverted !== false) status = WON_STATUS;
    naturalId = `sh:order:${s(p.id)}`;
  } else if (kind === "checkouts") {
    if (p.completed_at) return { leads: [], ignore: "Checkout completed — it arrives as an order" };
    medium = "abandoned checkout";
    comments = `${test}Abandoned checkout · ${total}${products ? `\nCart: ${products}` : ""}${p.abandoned_checkout_url ? `\nRecovery link: ${s(p.abandoned_checkout_url)}` : ""}`;
    naturalId = `sh:checkout:${s(p.id || p.token)}`;
  } else {
    const subscribed = s(p.email_marketing_consent?.state) === "subscribed" || p.accepts_marketing === true;
    medium = "sign-up";
    comments = `${test}New Shopify customer${subscribed ? " · subscribed to marketing" : ""}${p.note ? `\nNote: ${s(p.note).slice(0, 500)}` : ""}`;
    naturalId = `sh:customer:${s(p.id)}`;
  }
  const marketing = p.buyer_accepts_marketing === true || s(p.email_marketing_consent?.state || cust.email_marketing_consent?.state) === "subscribed";
  return {
    leads: [
      finish({
        name,
        email,
        phone,
        address: [street(addr), place(addr)].filter(Boolean).join(", ") || undefined,
        comments,
        source: "shopify",
        medium,
        campaign: utm?.utm_campaign || (kind !== "customers" ? s((p.line_items || [])[0]?.title) : "") || undefined,
        referral: s(p.referring_site).slice(0, 300) || undefined,
        utm,
        status,
        consent: marketing ? { email: true, text: "Accepted marketing at Shopify checkout / sign-up" } : undefined,
        customFields: { shopify_customer_id: s(cust.id) || undefined, shopify_order: kind === "orders" ? s(p.name) : undefined, order_value: kind !== "customers" ? Number(p.total_price) || undefined : undefined },
      }),
    ],
    naturalId,
  };
}

/* ─────────────── WooCommerce ─────────────── */

function wooKind(p: any): ShopEvent | null {
  const t = s(p._topic).toLowerCase();
  if (t) return t === "order.created" ? "orders" : t === "customer.created" ? "customers" : null;
  if (p.line_items || p.order_key || p.number) return "orders";
  if (p.email != null && (p.username != null || p.role != null)) return "customers";
  return null;
}
const metaOf = (p: any, key: string) => s((p.meta_data || []).find((m: any) => m?.key === key)?.value);

export function wooLead(p: any, cfg: any = {}): Adapted {
  if (p && p.webhook_id != null && Object.keys(p).filter((k) => !k.startsWith("_")).length === 1) return { leads: [], ignore: "WooCommerce ping" };
  const kind = wooKind(p);
  if (!kind) return { leads: [], ignore: `WooCommerce event ${p._topic || "(unknown)"} is not used for leads` };
  if (!enabled(cfg, kind)) return { leads: [], ignore: `Capturing ${kind} is switched off in Settings` };
  const bill = p.billing || {};
  const ship = p.shipping || {};
  const email = s(bill.email || p.email);
  const phone = s(bill.phone || ship.phone || p.phone);
  if (!email && !phone) return { leads: [], ignore: "No email or phone on this record" };
  const name = joinName(bill.first_name, bill.last_name) || joinName(p.first_name, p.last_name) || joinName(ship.first_name, ship.last_name) || s(p.username) || undefined;
  const addr = ship.city ? ship : bill;
  let comments = "";
  let medium = "";
  let status: string | undefined;
  let naturalId = "";
  let utm: Record<string, string> | undefined;
  let campaign: string | undefined;
  if (kind === "orders") {
    const st = s(p.status);
    if (["cancelled", "refunded", "trash", "checkout-draft"].includes(st)) return { leads: [], ignore: `Order status ${st}` };
    const paid = ["processing", "completed"].includes(st) || !!p.date_paid;
    medium = paid ? "order" : st === "failed" ? "failed payment" : "unpaid order";
    comments = `Order #${s(p.number || p.id)} · ${money(p.total, p.currency)} · ${st || "new"}${p.payment_method_title ? ` · ${s(p.payment_method_title)}` : ""}${items(p.line_items) ? `\nItems: ${items(p.line_items)}` : ""}${p.customer_note ? `\nNote: ${s(p.customer_note).slice(0, 500)}` : ""}`;
    if (paid && cfg.ordersAsConverted !== false) status = WON_STATUS;
    naturalId = `wc:order:${s(p.id)}`;
    // WooCommerce 8.5+ order attribution
    const u: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const v = metaOf(p, `_wc_order_attribution_${k}`);
      if (v && v !== "(none)") u[k] = v.slice(0, 200);
    }
    utm = Object.keys(u).length ? u : undefined;
    campaign = u.utm_campaign || s((p.line_items || [])[0]?.name) || undefined;
  } else {
    medium = "sign-up";
    comments = `New WooCommerce customer${p.username ? ` (${s(p.username)})` : ""}`;
    naturalId = `wc:customer:${s(p.id)}`;
  }
  return {
    leads: [
      finish({
        name,
        email,
        phone,
        address: [street(addr), place(addr)].filter(Boolean).join(", ") || undefined,
        comments,
        source: "woocommerce",
        medium,
        campaign,
        referral: metaOf(p, "_wc_order_attribution_referrer").slice(0, 300) || undefined,
        utm,
        status,
        customFields: { woo_customer_id: (kind === "customers" ? s(p.id) : Number(p.customer_id) > 0 ? s(p.customer_id) : "") || undefined, woo_order: kind === "orders" ? s(p.number || p.id) : undefined, order_value: kind === "orders" ? Number(p.total) || undefined : undefined },
      }),
    ],
    naturalId,
  };
}

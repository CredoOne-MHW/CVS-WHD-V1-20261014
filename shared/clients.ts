/** Client module helpers shared by API and UI. */

export const CLIENT_FREQUENCIES = [
  { key: "on_demand", label: "On-demand" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "half_yearly", label: "Half yearly" },
  { key: "yearly", label: "Yearly" },
] as const;
export type ClientFrequency = (typeof CLIENT_FREQUENCIES)[number]["key"];
export const CLIENT_FREQ_KEYS = CLIENT_FREQUENCIES.map((f) => f.key) as [ClientFrequency, ...ClientFrequency[]];
export const clientFreqLabel = (k?: string) => CLIENT_FREQUENCIES.find((f) => f.key === k)?.label || k || "—";

export const PAYMENT_MODES = ["NEFT", "CASH", "UPI", "Card", "RTGS"] as const;
export const CLIENT_PAY_STATUSES = [
  { key: "unpaid", label: "Unpaid" },
  { key: "overdue", label: "Over-Due" },
  { key: "paid", label: "Paid" },
] as const;
export const SUPPORT_CATEGORIES = ["Support", "Request", "Grievance"] as const;
export const TICKET_STATUS_LIST = ["Open", "In Progress", "On Hold", "Resolved", "Closed"] as const;

/** date + n periods (month maths clamps to the month's last day: 31 Jan + 1 month → 28/29 Feb). */
export function addClientPeriod(date: Date | string, freq: string, n = 1): Date {
  const d = new Date(date);
  if (freq === "weekly") return new Date(d.getTime() + 7 * 86_400_000 * n);
  const months = freq === "quarterly" ? 3 : freq === "half_yearly" ? 6 : freq === "yearly" ? 12 : 1;
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months * n);
  r.setUTCDate(Math.min(day, new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()));
  return r;
}

/** Discount: give either the fixed amount or the %; the other is derived. Gross never goes below 0. */
export function applyDiscount(amount: number, type: "fixed" | "percent", value: number) {
  const a = Math.max(0, Number(amount) || 0);
  const v = Math.max(0, Number(value) || 0);
  const discountAmount = round2(Math.min(a, type === "percent" ? (a * Math.min(v, 100)) / 100 : v));
  const percent = a ? round2((discountAmount / a) * 100) : 0;
  return { discountAmount, percent, gross: round2(a - discountAmount) };
}
/** A service / product the lead or client opted for, with its number of licences. */
/**
 * Attachment types — the S3 folder under <Company Code>/<Client Code>/<type>/ is picked automatically from where the file
 * is added (an Invoice marked Paid → "Payment"; a client photo → "Profile Photo"; …). Add a type here for a new place.
 */
export const ATTACHMENT_TYPES = ["Payment", "Profile Photo", "Support Ticket", "Document"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export const ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt";
export const ATTACHMENT_MAX_MB = 8;

export type ServiceLine = { service: string; licenses: number };
/** Service lines of a lead/client — older records only have service names (1 licence each). */
export const linesOf = (l: { serviceLines?: ServiceLine[] | null; services?: string[] | null }): ServiceLine[] =>
  l?.serviceLines?.length ? l.serviceLines.map((x) => ({ service: x.service, licenses: Number(x.licenses) || 1 })) : (l?.services || []).map((s) => ({ service: s, licenses: 1 }));

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/* ─────────── Indian business identifiers ─────────── */
export const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Verhoeff checksum (UIDAI uses it for the last digit of every Aadhaar number)
const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function aadhaarValid(v: string) {
  const d = String(v || "").replace(/\s/g, "");
  if (!/^[2-9][0-9]{11}$/.test(d)) return false;
  let c = 0;
  d.split("")
    .reverse()
    .forEach((ch, i) => (c = VD[c][VP[i % 8][Number(ch)]]));
  return c === 0;
}
export const maskAadhaar = (last4?: string) => (last4 ? `XXXX XXXX ${last4}` : "");

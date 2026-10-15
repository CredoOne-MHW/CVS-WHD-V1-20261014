/** Billing & allocation cycles shared by server and UI (renewal dates are computed identically on both sides). */
export const FREQUENCIES = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "half_yearly", label: "Half Yearly" },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]["key"];
export const FREQ_KEYS = FREQUENCIES.map((f) => f.key) as [Frequency, ...Frequency[]];
export const freqLabel = (k?: string) => FREQUENCIES.find((f) => f.key === k)?.label || k || "—";

export const REMINDER_DAYS = [
  { key: 1, label: "1 Day Prior" },
  { key: 3, label: "3 Days Prior" },
  { key: 7, label: "7 Days Prior" },
] as const;

export const PAYMENT_STATUSES = [
  { key: "unpaid", label: "Unpaid" },
  { key: "paid", label: "Paid" },
  { key: "overdue", label: "Over Due" },
  { key: "expired", label: "Expired" },
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]["key"];
export const EXPIRE_AFTER_DAYS = 30;
export const DAY = 86_400_000;

/** start + n periods. Month maths clamps to the month's last day (31 Jan + 1 month → 28/29 Feb). */
export function addPeriod(date: Date | string, freq: Frequency | string, n = 1): Date {
  const d = new Date(date);
  if (freq === "weekly") return new Date(d.getTime() + 7 * DAY * n);
  const months = freq === "quarterly" ? 3 : freq === "half_yearly" ? 6 : 1;
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months * n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

/** First renewal strictly after `now` for a cycle that started at `start` (start may be in the past). */
export function nextRenewal(start: Date | string, freq: Frequency | string, now: Date = new Date()): Date {
  let r = addPeriod(start, freq);
  for (let i = 0; r <= now && i < 1000; i++) r = addPeriod(r, freq);
  return r;
}

/** What the UI shows: unpaid past the due date is Over Due; Over Due 30 days past it is Expired. */
export function effectiveStatus(status: string, due: Date | string, now: Date = new Date()): PaymentStatus {
  if (status === "paid") return "paid";
  const late = now.getTime() - new Date(due).getTime();
  if (status === "expired" || late >= EXPIRE_AFTER_DAYS * DAY) return "expired";
  if (status === "overdue" || late > 0) return "overdue";
  return "unpaid";
}

export function discountOf(amount: number, type: string, value: number) {
  const v = Math.max(0, Number(value) || 0);
  return Math.min(amount, type === "percent" ? (amount * Math.min(v, 100)) / 100 : v);
}

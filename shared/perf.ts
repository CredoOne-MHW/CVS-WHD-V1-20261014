/** Latency budgets (ms) and histogram buckets used by the API metrics and the System Health page. */
export const READ_BUDGET_MS = 300;
export const WRITE_BUDGET_MS = 500;
export const BUCKETS = [10, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 2000, 5000, 10000, Infinity];

/** Percentile from bucket counts (upper bound of the bucket that holds the percentile). */
export function percentile(b: number[], p: number, max?: number) {
  const total = b.reduce((a, x) => a + (x || 0), 0);
  if (!total) return 0;
  const target = Math.ceil(total * p);
  let acc = 0;
  for (let i = 0; i < BUCKETS.length; i++) {
    acc += b[i] || 0;
    if (acc >= target) return BUCKETS[i] === Infinity ? max || 10000 : Math.min(BUCKETS[i], max || BUCKETS[i]);
  }
  return max || 0;
}

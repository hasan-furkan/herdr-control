// Monthly traffic limits per machine (name as Herdr / tailscale shows it).
// TB = 10^12 bytes. count: "total" (download + upload) or "out" (upload only) —
// check which one your provider bills. billing_day: day of month the period starts.
// Example (fill in the real machine name once the server exists):
//   "build-server": { monthly_tb: 30, count: "total", billing_day: 1 },
export const TRAFFIC_LIMITS = {};

// OpenCode Go plan: the allowance runs from day 24 (local time) and lists at
// 80 USD per month; Go charges the allowance at 0.6 x the API list price.
export const OPENCODE_GO = { billingDay: 24, monthlyUsd: 80, chargeFactor: 0.6 };

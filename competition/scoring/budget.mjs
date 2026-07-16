// Per-author monthly budget (spec §6.1.2, D5). Sums billed dollars from committed
// results/runs/*.json for an author in a calendar month; over the cap blocks further
// full runs (smoke still allowed until it too would exceed the remainder). Pure over
// an array of run objects so it's trivially testable; readRuns() is the IO wrapper.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** yyyy-mm of an ISO timestamp. */
export const monthOf = (iso) => (iso || "").slice(0, 7);

/** Sum an author's billed dollars in `yyyymm` across run objects. */
export function monthlySpend(runs, author, yyyymm) {
  return runs
    .filter((r) => r.author === author && monthOf(r.started_at) === yyyymm && !r.validity?.voided)
    .reduce((sum, r) => sum + (Number(r.median_billed_usd) || 0), 0);
}

/**
 * Budget decision for the next run.
 * Returns { allowed, spent, remaining, reason }.
 * - full run needs the whole cap headroom to even start;
 * - smoke run only needs `nextCost` (its own cap) to fit the remainder (§6.1.2).
 */
export function budgetCheck({ runs, author, yyyymm, cap, runType, nextCost }) {
  const spent = Number(monthlySpend(runs, author, yyyymm).toFixed(4));
  const remaining = Number((cap - spent).toFixed(4));
  if (remaining <= 0) {
    return { allowed: false, spent, remaining, reason: "monthly-budget-exhausted" };
  }
  if (runType === "smoke" && nextCost != null && nextCost > remaining) {
    return { allowed: false, spent, remaining, reason: "monthly-budget-exhausted" };
  }
  return { allowed: true, spent, remaining, reason: null };
}

/** Load every results/runs/*.json (skips .minisig and non-JSON). */
export function readRuns(runsDir) {
  let names;
  try {
    names = readdirSync(runsDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      try {
        return JSON.parse(readFileSync(join(runsDir, n), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

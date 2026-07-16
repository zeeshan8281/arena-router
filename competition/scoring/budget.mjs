// Per-author monthly budget (spec §6.1.2, D5). Sums billed dollars from committed
// results/runs/*.json for an author in a calendar month; over the cap blocks further
// full runs (smoke still allowed until it too would exceed the remainder). Pure over
// an array of run objects so it's trivially testable; readRuns() is the IO wrapper.
//
// H3: VOIDED runs still count toward the cap — a voided run's inference was billed to
// the org's real money, so a griefer can't dodge their $30/mo cap by deliberately
// voiding runs. We sum every run's billed amount; a run that never billed simply
// contributes 0 (its median_billed_usd is 0).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** yyyy-mm of an ISO timestamp. */
export const monthOf = (iso) => (iso || "").slice(0, 7);

/** Sum an author's billed dollars in `yyyymm` across run objects. */
export function monthlySpend(runs, author, yyyymm) {
  // Include voided runs (H3): real money was billed regardless of validity.
  return runs
    .filter((r) => r.author === author && monthOf(r.started_at) === yyyymm)
    .reduce((sum, r) => sum + (Number(r.median_billed_usd) || 0), 0);
}

/**
 * Budget decision for the next run.
 * Returns { allowed, spent, remaining, reason }.
 * - full run needs the whole cap headroom (`nextCost`, the full cap) to even start —
 *   a full run can burn up to its cap, so a small positive remainder is not enough (M1);
 * - smoke run only needs `nextCost` (its own cap) to fit the remainder (§6.1.2).
 */
export function budgetCheck({ runs, author, yyyymm, cap, runType, nextCost }) {
  const spent = Number(monthlySpend(runs, author, yyyymm).toFixed(4));
  const remaining = Number((cap - spent).toFixed(4));
  if (remaining <= 0) {
    return { allowed: false, spent, remaining, reason: "monthly-budget-exhausted" };
  }
  // full: require the whole next-run cap to fit; smoke: same fit-the-remainder rule.
  if (runType === "full" && nextCost != null && nextCost > remaining) {
    return { allowed: false, spent, remaining, reason: "monthly-budget-insufficient-headroom" };
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

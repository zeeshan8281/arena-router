// Scoring aggregation — smoke-subset §5 + benchmark-survey §1. The cost number
// is billed dollars from the OpenRouter ledger (already includes caching); this
// module just aggregates trials and applies the gate. It never models cost.
//
// A "trial" = one full run of the task set: { passed: <int>, cost_usd: <number> }.
// Smoke uses median-of-3 (per-task tokens vary up to 30x, so a single trial is noise).

export function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Median-TRIAL aggregation (§5: median, not pass@N, not mean). Pass and cost must
 *  describe ONE real trial — taking each over an independently-sorted column can report
 *  a (pass, cost) pair that no single trial produced (M9). So: pick the trial at the
 *  median pass position (lower-middle for an even count) and report THAT trial's cost. */
export function aggregate(trials) {
  const ordered = [...trials].sort((a, b) => a.passed - b.passed);
  const n = ordered.length;
  const medianTrial = n ? ordered[Math.floor((n - 1) / 2)] : { passed: 0, cost_usd: 0 };
  return {
    trials: n,
    median_pass: median(trials.map((t) => t.passed)),
    median_cost: Number((medianTrial.cost_usd || 0).toFixed(4)),
  };
}

/** Smoke gate — pass count only (§5: cost is recorded but not gated at smoke).
 *  threshold is frozen after the baseline probe; "baseline − 1" until then. */
export function smokeGate(medianPass, threshold) {
  return { pass: medianPass >= threshold, median_pass: medianPass, threshold };
}

/** Full-run leaderboard entry: must meet the baseline pass rate, then rank by
 *  lowest billed cost. Below baseline ⇒ not ranked (§ pivot: match/beat, then cheapest). */
export function leaderboardEntry({ participant, median_pass, median_cost, baseline_pass, integrity }) {
  const qualified = !integrity?.void && median_pass >= baseline_pass;
  return {
    participant,
    pass: median_pass,
    cost_usd: median_cost,
    qualified,
    ...(integrity?.void ? { void: true, flags: integrity.flags } : {}),
  };
}

/** Rank qualified entries cheapest-first; unqualified/void sink to the bottom.
 *  L1: break exact cost ties deterministically (by run_id, then participant) so ordering
 *  never depends on input/readdir order. */
export function rankLeaderboard(entries) {
  return [...entries].sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    if (a.cost_usd !== b.cost_usd) return a.cost_usd - b.cost_usd;
    return String(a.run_id ?? a.participant ?? "").localeCompare(String(b.run_id ?? b.participant ?? "")) ||
      String(a.participant ?? "").localeCompare(String(b.participant ?? ""));
  }).map((e, i) => ({ rank: e.qualified ? i + 1 : null, ...e }));
}

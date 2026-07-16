// Tests for budget + results (spec §6.1.2, §7). Run:
//   node --test competition/scoring/pipeline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { monthlySpend, budgetCheck } from "./budget.mjs";
import { buildRunResult, generateLeaderboard } from "./results.mjs";

test("buildRunResult output has every schema-required top-level key", () => {
  const schema = JSON.parse(readFileSync(new URL("../../results/schema/run.schema.json", import.meta.url)));
  const r = buildRunResult({
    runId: "pr1-full-a1", runType: "full", pr: 1, author: "alice",
    startedAt: "t0", finishedAt: "t1", trials: [{ pass_count: 5, billed_usd: 2.0 }],
  });
  for (const k of schema.required) assert.ok(k in r, `missing required key: ${k}`);
});

const RUNS = [
  { author: "alice", started_at: "2026-07-02T10:00:00", median_billed_usd: 4.0, validity: { voided: false } },
  { author: "alice", started_at: "2026-07-20T10:00:00", median_billed_usd: 5.0, validity: { voided: false } },
  { author: "alice", started_at: "2026-06-01T10:00:00", median_billed_usd: 9.0, validity: { voided: false } }, // prev month
  { author: "bob", started_at: "2026-07-05T10:00:00", median_billed_usd: 3.0, validity: { voided: false } },
  { author: "alice", started_at: "2026-07-22T10:00:00", median_billed_usd: 99.0, validity: { voided: true } }, // void, ignored
];

test("monthlySpend sums only that author, that month, non-void", () => {
  assert.equal(monthlySpend(RUNS, "alice", "2026-07"), 9.0);
  assert.equal(monthlySpend(RUNS, "bob", "2026-07"), 3.0);
  assert.equal(monthlySpend(RUNS, "alice", "2026-06"), 9.0);
});

test("budgetCheck: full needs full headroom; exhausted blocks", () => {
  const over = budgetCheck({ runs: RUNS, author: "alice", yyyymm: "2026-07", cap: 9, runType: "full" });
  assert.equal(over.allowed, false);
  assert.equal(over.reason, "monthly-budget-exhausted");

  const ok = budgetCheck({ runs: RUNS, author: "bob", yyyymm: "2026-07", cap: 30, runType: "full" });
  assert.equal(ok.allowed, true);
  assert.equal(ok.remaining, 27);
});

test("budgetCheck: smoke allowed until its own cost exceeds the remainder", () => {
  const near = budgetCheck({ runs: RUNS, author: "alice", yyyymm: "2026-07", cap: 10, runType: "smoke", nextCost: 1.5 });
  assert.equal(near.allowed, false); // remaining 1.0 < 1.5
  const fits = budgetCheck({ runs: RUNS, author: "alice", yyyymm: "2026-07", cap: 11, runType: "smoke", nextCost: 1.5 });
  assert.equal(fits.allowed, true); // remaining 2.0 >= 1.5
});

test("buildRunResult medians across trials", () => {
  const r = buildRunResult({
    runId: "pr7-smoke-a1", runType: "smoke", pr: 7, author: "alice", entryName: "cheap",
    startedAt: "t0", finishedAt: "t1",
    trials: [
      { pass_count: 10, billed_usd: 1.2 },
      { pass_count: 12, billed_usd: 1.0 },
      { pass_count: 11, billed_usd: 1.4 },
    ],
  });
  assert.equal(r.median_pass_count, 11);
  assert.equal(r.median_billed_usd, 1.2);
  assert.equal(r.schema_version, 1);
});

test("leaderboard: per-author cheapest eligible, ranked; below-bar separate; baseline pinned", () => {
  const runs = [
    { run_type: "baseline", author: "_baseline", median_pass_count: 40, median_billed_usd: 8.0, run_id: "b1" },
    { run_type: "full", author: "alice", entry_name: "a1", run_id: "r1", median_pass_count: 42, median_billed_usd: 6.0, validity: { voided: false } },
    { run_type: "full", author: "alice", entry_name: "a2", run_id: "r2", median_pass_count: 42, median_billed_usd: 5.0, validity: { voided: false } }, // cheaper, wins for alice
    { run_type: "full", author: "bob", entry_name: "b", run_id: "r3", median_pass_count: 41, median_billed_usd: 3.0, validity: { voided: false } }, // cheapest overall
    { run_type: "full", author: "carol", entry_name: "c", run_id: "r4", median_pass_count: 30, median_billed_usd: 1.0, validity: { voided: false } }, // below bar
    { run_type: "full", author: "eve", entry_name: "e", run_id: "r5", median_pass_count: 99, median_billed_usd: 2.0, validity: { voided: true } }, // void, excluded
  ];
  const lb = generateLeaderboard(runs, { eligibilityBar: 40 });
  assert.equal(lb.baseline.pass, 40);
  assert.deepEqual(lb.ranked.map((e) => e.participant), ["bob", "alice"]); // 3.0 < 5.0
  assert.equal(lb.ranked[0].rank, 1);
  assert.equal(lb.ranked.find((e) => e.participant === "alice").cost_usd, 5.0); // cheaper alice run
  assert.deepEqual(lb.below_bar.map((e) => e.participant), ["carol"]);
});

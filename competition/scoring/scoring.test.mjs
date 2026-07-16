// Offline checks for scoring + integrity. Run: node --test competition/scoring/scoring.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIntegrity, tokenAnomalies } from "./integrity.mjs";
import { median, aggregate, smokeGate, leaderboardEntry, rankLeaderboard } from "./score.mjs";

const ALLOW = ["z-ai/glm-5.2", "openai/gpt-oss-120b"];

test("integrity: all-allowlisted, no byok → clean", () => {
  const r = checkIntegrity({ generations: [{ model: "z-ai/glm-5.2" }, { model: "openai/gpt-oss-120b" }], keyStatus: { byok_usage: 0 }, allowlist: ALLOW });
  assert.equal(r.void, false);
  assert.equal(r.flags.length, 0);
});

test("integrity: off-allowlist model voids the run", () => {
  const r = checkIntegrity({ generations: [{ model: "anthropic/claude-4" }], allowlist: ALLOW });
  assert.equal(r.void, true);
  assert.equal(r.flags[0].type, "off-allowlist");
});

test("integrity: :free variant and BYOK both void", () => {
  const r = checkIntegrity({ generations: [{ model: "z-ai/glm-5.2:free" }], keyStatus: { byok_usage: 0.4 }, allowlist: ALLOW });
  assert.equal(r.void, true);
  assert.deepEqual(r.flags.map((f) => f.type).sort(), ["byok", "free-variant"]);
});

test("token anomaly: hard task passing on <5k tokens flags for review", () => {
  const a = tokenAnomalies([
    { task: "password-recovery", passed: true, difficulty: "hard", total_tokens: 1200 },
    { task: "fix-git", passed: true, difficulty: "easy", total_tokens: 800 },
    { task: "write-compressor", passed: false, difficulty: "hard", total_tokens: 100 },
  ]);
  assert.equal(a.length, 1);
  assert.equal(a[0].task, "password-recovery");
});

test("median-of-3 aggregation (not mean, not max)", () => {
  assert.equal(median([2, 9, 5]), 5);
  const g = aggregate([{ passed: 10, cost_usd: 4 }, { passed: 12, cost_usd: 9 }, { passed: 11, cost_usd: 6 }]);
  assert.equal(g.median_pass, 11);
  assert.equal(g.median_cost, 6);
});

test("smoke gate is pass-count only", () => {
  assert.equal(smokeGate(11, 10).pass, true);
  assert.equal(smokeGate(9, 10).pass, false);
});

test("leaderboard: below baseline pass rate ⇒ unqualified; ranked cheapest-first", () => {
  const entries = [
    leaderboardEntry({ participant: "gh:a", median_pass: 70, median_cost: 6.0, baseline_pass: 65 }),
    leaderboardEntry({ participant: "gh:b", median_pass: 66, median_cost: 3.5, baseline_pass: 65 }),
    leaderboardEntry({ participant: "gh:c", median_pass: 60, median_cost: 1.0, baseline_pass: 65 }),
    leaderboardEntry({ participant: "gh:d", median_pass: 80, median_cost: 9.0, baseline_pass: 65, integrity: { void: true, flags: [] } }),
  ];
  const board = rankLeaderboard(entries);
  assert.equal(board[0].participant, "gh:b");   // cheapest qualified
  assert.equal(board[1].participant, "gh:a");
  assert.equal(board.find((e) => e.participant === "gh:c").rank, null); // below baseline
  assert.equal(board.find((e) => e.participant === "gh:d").rank, null); // void
});

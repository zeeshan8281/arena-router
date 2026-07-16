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
  const r = checkIntegrity({ generations: [{ model: "anthropic/claude-4" }], keyStatus: { byok_usage: 0 }, allowlist: ALLOW });
  assert.equal(r.void, true);
  assert.equal(r.flags[0].type, "off-allowlist");
});

test("H1: a generation record with empty/missing model voids (missing-model)", () => {
  const empty = checkIntegrity({ generations: [{ model: "" }], keyStatus: { byok_usage: 0 }, allowlist: ALLOW });
  assert.equal(empty.void, true);
  assert.ok(empty.flags.some((f) => f.type === "missing-model"));
  const absent = checkIntegrity({ generations: [{}], keyStatus: { byok_usage: 0 }, allowlist: ALLOW });
  assert.equal(absent.void, true);
  assert.ok(absent.flags.some((f) => f.type === "missing-model"));
});

test("H2: empty generations list is unverifiable → void (no-generations)", () => {
  const r = checkIntegrity({ generations: [], keyStatus: { byok_usage: 0 }, allowlist: ALLOW });
  assert.equal(r.void, true);
  assert.ok(r.flags.some((f) => f.type === "no-generations"));
});

test("H9: null/absent keyStatus is unverifiable → void (keystatus-unavailable)", () => {
  const r = checkIntegrity({ generations: [{ model: "z-ai/glm-5.2" }], keyStatus: null, allowlist: ALLOW });
  assert.equal(r.void, true);
  assert.ok(r.flags.some((f) => f.type === "keystatus-unavailable"));
  // a non-finite byok_usage is equally unverifiable
  const nan = checkIntegrity({ generations: [{ model: "z-ai/glm-5.2" }], keyStatus: { byok_usage: undefined }, allowlist: ALLOW });
  assert.ok(nan.flags.some((f) => f.type === "keystatus-unavailable"));
});

test("integrity: :free variant and BYOK both void", () => {
  const r = checkIntegrity({ generations: [{ model: "z-ai/glm-5.2:free" }], keyStatus: { byok_usage: 0.4 }, allowlist: ALLOW });
  assert.equal(r.void, true);
  assert.deepEqual(r.flags.map((f) => f.type).sort(), ["byok", "free-variant"]);
});

test("M3: token anomaly uses prompt+completion (real ledger shape), case-insensitive difficulty", () => {
  const a = tokenAnomalies([
    // real ledger rows: no total_tokens, "Hard" mixed-case → must still fire
    { task: "password-recovery", passed: true, difficulty: "Hard", tokens_prompt: 800, tokens_completion: 400 }, // 1200 < 5000
    { task: "fix-git", passed: true, difficulty: "easy", tokens_prompt: 400, tokens_completion: 400 },
    { task: "write-compressor", passed: false, difficulty: "hard", tokens_prompt: 50, tokens_completion: 50 }, // failed → ignored
    { task: "big-hard", passed: true, difficulty: "hard", tokens_prompt: 4000, tokens_completion: 4000 }, // 8000 ≥ 5000
  ]);
  assert.equal(a.length, 1);
  assert.equal(a[0].task, "password-recovery");
  assert.equal(a[0].tokens, 1200); // computed from prompt+completion
});

test("M3: total_tokens is still honored when present", () => {
  const a = tokenAnomalies([{ task: "t", passed: true, difficulty: "hard", total_tokens: 1200 }]);
  assert.equal(a.length, 1);
  assert.equal(a[0].tokens, 1200);
});

test("M9: aggregate reports the median TRIAL's cost, not a decoupled cost column", () => {
  assert.equal(median([2, 9, 5]), 5);
  // median pass is trial with passed=11, whose cost is 6 — NOT the median of the cost column (also 6 here)
  const g = aggregate([{ passed: 10, cost_usd: 4 }, { passed: 12, cost_usd: 9 }, { passed: 11, cost_usd: 6 }]);
  assert.equal(g.median_pass, 11);
  assert.equal(g.median_cost, 6); // cost of the passed=11 trial

  // decoupling would matter here: sorted-cost median is 5, but the median-pass trial costs 9
  const g2 = aggregate([{ passed: 5, cost_usd: 2 }, { passed: 9, cost_usd: 9 }, { passed: 7, cost_usd: 5 }]);
  assert.equal(g2.median_pass, 7);
  assert.equal(g2.median_cost, 5); // trial with passed=7 costs 5 (real pair, not min/median of column)
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

test("L1: exact cost ties break deterministically (by run_id), independent of input order", () => {
  const mk = (participant, run_id) => ({ participant, run_id, cost_usd: 5.0, qualified: true });
  const a = rankLeaderboard([mk("z", "r3"), mk("a", "r1"), mk("m", "r2")]);
  const b = rankLeaderboard([mk("m", "r2"), mk("z", "r3"), mk("a", "r1")]);
  assert.deepEqual(a.map((e) => e.run_id), ["r1", "r2", "r3"]);
  assert.deepEqual(a.map((e) => e.run_id), b.map((e) => e.run_id)); // order-independent
});

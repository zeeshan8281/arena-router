// Runner orchestration tests (spec §6.1) — all seams mocked, no key/Docker. Run:
//   node --test competition/runner.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harborArgs, selectTasks, planFor, keyName, nextAttempt, runRun } from "./runner.mjs";
import { loadConfig } from "./scoring/config.mjs";

// a frozen config so assertRunnable passes
function frozenConfig() {
  const c = loadConfig();
  c.smoke.gate = 10;
  c.full.eligibility_bar = 40;
  return c;
}

// build a harbor result.json object with a given pass/fail per task
function harborResult(passByTask) {
  const reward = {};
  for (const [task, pass] of Object.entries(passByTask)) {
    const k = pass ? "1.0" : "0.0";
    (reward[k] ??= []).push(`${task}__x`);
  }
  return { n_total_trials: 1, stats: { n_trials: 1, n_errors: 0, evals: { e: { reward_stats: { reward } } } } };
}

test("harborArgs is exact", () => {
  const a = harborArgs({ dataset: "terminal-bench/terminal-bench-2", tasks: ["fix-git", "pypi-server"], model: "openrouter/z-ai/glm-5.2", outDir: "/o", concurrency: 4 });
  assert.deepEqual(a, ["run", "-d", "terminal-bench/terminal-bench-2", "--agent-import-path", "pi_agent:PiAgent", "-m", "openrouter/z-ai/glm-5.2", "-n", "4", "-o", "/o", "-t", "fix-git", "-t", "pypi-server"]);
});

test("selectTasks / planFor / keyName", () => {
  const c = frozenConfig();
  assert.equal(selectTasks(c, "smoke", ["a", "b", "c"]).length, 16);
  assert.deepEqual(selectTasks(c, "full", ["a", "b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(planFor(c, "smoke"), { cap: 1.5, trials: 3, capExempt: false });
  assert.deepEqual(planFor(c, "baseline"), { cap: 10, trials: 1, capExempt: true });
  assert.equal(keyName("smoke", 42), "pr42-smoke-a1");
});

test("smoke run: 3 trials aggregated, per-trial cost from key deltas, gate applied", async () => {
  const c = frozenConfig();
  const costs = [0.4, 0.9, 1.5]; // cumulative billed read after each trial
  let costIdx = 0, trial = 0;
  const passes = [
    { "fix-git": true, "pypi-server": false }, // 1 pass
    { "fix-git": true, "pypi-server": true },  // 2 pass
    { "fix-git": true, "pypi-server": false }, // 1 pass -> median 1
  ];
  const deps = {
    allTasks: ["x"], priorRuns: [], now: () => "2026-07-17T00:00:00Z", startedAt: "2026-07-17T00:00:00Z",
    mint: async () => ({ key: "sk-inf", hash: "h1" }),
    del: async () => {},
    cost: async () => ({ usage: costs[Math.min(costIdx++, costs.length - 1)], byok_usage: 0 }),
    // A verifiable run needs at least one allowlisted generation record (integrity is
    // fail-closed on zero records) — the final cost read is the last cost() call.
    generations: async () => [{ id: "g", model: "z-ai/glm-5.2" }],
    runTrial: async () => harborResult(passes[trial++]),
  };
  const r = await runRun({ config: c, type: "smoke", pr: 7, author: "alice", model: "z-ai/glm-5.2", deps });
  assert.equal(r.trials.length, 3);
  assert.equal(r.median_pass_count, 1);
  assert.deepEqual(r.trials.map((t) => t.billed_usd), [0.4, 0.5, 0.6]); // deltas of cumulative
  assert.equal(r.median_billed_usd, 0.5);
  assert.equal(r.validity.voided, false);
  assert.equal(r.smoke_gate.pass, false); // 1 < gate 10
});

test("budget-exhausted → void before any key mint", async () => {
  const c = frozenConfig();
  let minted = false;
  const deps = {
    allTasks: ["x"], now: () => "2026-07-17T00:00:00Z",
    priorRuns: [{ author: "alice", started_at: "2026-07-01T00:00:00Z", median_billed_usd: 30, validity: { voided: false } }],
    mint: async () => { minted = true; return { key: "k", hash: "h" }; },
    del: async () => {}, cost: async () => ({ usage: 0, byok_usage: 0 }), runTrial: async () => harborResult({}),
  };
  const r = await runRun({ config: c, type: "full", pr: 1, author: "alice", deps });
  assert.equal(r.validity.voided, true);
  assert.equal(minted, false);
});

test("per-record allowlist: a real generation off the allowlist voids; clean sets audit trail", async () => {
  const c = frozenConfig();
  // clean run — two allowlisted records → models_allowlisted true, trial[0] gets the audit trail
  const cleanDeps = {
    allTasks: ["x"], priorRuns: [], now: () => "t", startedAt: "t",
    mint: async () => ({ key: "k", hash: "h" }), del: async () => {},
    cost: async () => ({ usage: 3.0, byok_usage: 0 }),
    runTrial: async () => harborResult({ "fix-git": true }),
    generations: async () => [
      { id: "gen-1", model: "z-ai/glm-5.2", tokens_prompt: 1000, tokens_completion: 200, cache_read_tokens: 50 },
      { id: "gen-2", model: "z-ai/glm-5.2", tokens_prompt: 500, tokens_completion: 100, cache_read_tokens: 0 },
    ],
  };
  const ok = await runRun({ config: c, type: "full", pr: 3, author: "alice", model: "z-ai/glm-5.2", deps: cleanDeps });
  assert.equal(ok.validity.voided, false);
  assert.equal(ok.validity.models_allowlisted, true);
  assert.deepEqual(ok.trials[0].generation_ids, ["gen-1", "gen-2"]);
  assert.equal(ok.trials[0].input_tokens, 1500);
  assert.equal(ok.trials[0].output_tokens, 300);
  assert.equal(ok.openrouter_key_name, "pr3-full-a1");

  // one off-allowlist record → void, even though we told pi to use an allowlisted model
  const cheatDeps = { ...cleanDeps, generations: async () => [{ id: "g", model: "openai/gpt-5", tokens_prompt: 1 }] };
  const bad = await runRun({ config: c, type: "full", pr: 4, author: "alice", model: "z-ai/glm-5.2", deps: cheatDeps });
  assert.equal(bad.validity.voided, true);
  assert.equal(bad.validity.models_allowlisted, false);
});

test("off-allowlist model voids the run", async () => {
  const c = frozenConfig();
  const deps = {
    allTasks: ["x"], priorRuns: [], now: () => "t", startedAt: "t",
    mint: async () => ({ key: "k", hash: "h" }), del: async () => {},
    cost: async () => ({ usage: 0.1, byok_usage: 0 }),
    runTrial: async () => harborResult({ "fix-git": true }),
  };
  const r = await runRun({ config: c, type: "baseline", pr: 0, author: "_baseline", model: "anthropic/claude-4", deps });
  assert.equal(r.validity.voided, true);
});

// C3: the authoritative final reads (cost/generations) must run while the key is ALIVE,
// i.e. BEFORE del(hash). Track call order in the stubs and assert it.
test("C3: final cost + generations are read before the key is deleted", async () => {
  const c = frozenConfig();
  const order = [];
  const deps = {
    allTasks: ["x"], priorRuns: [], now: () => "t", startedAt: "t",
    mint: async () => ({ key: "k", hash: "h" }),
    del: async () => { order.push("del"); },
    cost: async () => { order.push("cost"); return { usage: 1.0, byok_usage: 0 }; },
    generations: async () => { order.push("generations"); return [{ id: "g", model: "z-ai/glm-5.2" }]; },
    runTrial: async () => harborResult({ "fix-git": true }),
  };
  const r = await runRun({ config: c, type: "full", pr: 5, author: "alice", model: "z-ai/glm-5.2", deps });
  assert.equal(r.validity.voided, false);
  // the LAST cost read (final status) and the generations read both precede del
  assert.ok(order.indexOf("generations") < order.indexOf("del"), `generations before del: ${order}`);
  assert.ok(order.lastIndexOf("cost") < order.indexOf("del"), `final cost before del: ${order}`);
});

// C3: if the authoritative reads THROW (deleted-key / API failure), the run must VOID
// rather than fall back to {byok_usage:0} / [{model:runModel}] (which would no-op both gates).
test("C3: final cost read failure fails closed → void (integrity-read-failed)", async () => {
  const c = frozenConfig();
  let costCalls = 0;
  const deps = {
    allTasks: ["x"], priorRuns: [], now: () => "t", startedAt: "t",
    mint: async () => ({ key: "k", hash: "h" }),
    del: async () => {},
    // per-trial cost reads succeed; the FINAL read (after the loop) throws
    cost: async () => { costCalls++; if (costCalls > 1) throw new Error("key gone"); return { usage: 0.5, byok_usage: 0 }; },
    generations: async () => [{ id: "g", model: "z-ai/glm-5.2" }],
    runTrial: async () => harborResult({ "fix-git": true }),
  };
  const r = await runRun({ config: c, type: "full", pr: 6, author: "alice", model: "z-ai/glm-5.2", deps });
  assert.equal(r.validity.voided, true);
  assert.equal(r.validity.void_reason, "integrity-read-failed");
});

test("C3: generations read failure fails closed → void", async () => {
  const c = frozenConfig();
  const deps = {
    allTasks: ["x"], priorRuns: [], now: () => "t", startedAt: "t",
    mint: async () => ({ key: "k", hash: "h" }),
    del: async () => {},
    cost: async () => ({ usage: 0.5, byok_usage: 0 }),
    generations: async () => { throw new Error("key gone"); },
    runTrial: async () => harborResult({ "fix-git": true }),
  };
  const r = await runRun({ config: c, type: "full", pr: 8, author: "alice", model: "z-ai/glm-5.2", deps });
  assert.equal(r.validity.voided, true);
  assert.equal(r.validity.void_reason, "integrity-read-failed");
});

// C3: del() is still called (teardown guaranteed) even when the final reads throw.
test("C3: key is still deleted when the integrity reads throw", async () => {
  const c = frozenConfig();
  let deleted = false;
  const deps = {
    allTasks: ["x"], priorRuns: [], now: () => "t", startedAt: "t",
    mint: async () => ({ key: "k", hash: "h" }),
    del: async () => { deleted = true; },
    cost: async () => ({ usage: 0.5, byok_usage: 0 }),
    generations: async () => { throw new Error("key gone"); },
    runTrial: async () => harborResult({ "fix-git": true }),
  };
  await runRun({ config: c, type: "full", pr: 9, author: "alice", model: "z-ai/glm-5.2", deps });
  assert.equal(deleted, true);
});

// M2: attempt is real — nextAttempt counts existing run files, and two attempts on the
// same PR produce two distinct run files (so monthlySpend counts both, not just the latest).
test("M2: nextAttempt increments past existing attempt files", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "runs-attempt-"));
  assert.equal(nextAttempt(runsDir, "full", 7), 1); // empty dir
  writeFileSync(join(runsDir, "pr7-full-a1.json"), "{}");
  writeFileSync(join(runsDir, "pr7-full-a2.json"), "{}");
  writeFileSync(join(runsDir, "pr7-smoke-a1.json"), "{}"); // different type, ignored
  writeFileSync(join(runsDir, "pr8-full-a5.json"), "{}");  // different pr, ignored
  assert.equal(nextAttempt(runsDir, "full", 7), 3);
  assert.equal(nextAttempt(runsDir, "smoke", 7), 2);
});

test("M2: two attempts on one PR write two files, both counted by monthlySpend", async () => {
  const { writeRun } = await import("./scoring/results.mjs");
  const { readRuns, monthlySpend } = await import("./scoring/budget.mjs");
  const runsDir = mkdtempSync(join(tmpdir(), "runs-m2-"));
  const c = frozenConfig();
  const mkDeps = () => ({
    allTasks: ["x"], priorRuns: readRuns(runsDir), now: () => "2026-07-17T00:00:00Z", startedAt: "2026-07-17T00:00:00Z",
    mint: async () => ({ key: "k", hash: "h" }), del: async () => {},
    cost: async () => ({ usage: 2.0, byok_usage: 0 }),
    generations: async () => [{ id: "g", model: "z-ai/glm-5.2" }],
    runTrial: async () => harborResult({ "fix-git": true }),
  });
  const a1 = await runRun({ config: c, type: "full", pr: 11, author: "alice", model: "z-ai/glm-5.2", attempt: nextAttempt(runsDir, "full", 11), deps: mkDeps() });
  writeRun(runsDir, a1);
  const a2 = await runRun({ config: c, type: "full", pr: 11, author: "alice", model: "z-ai/glm-5.2", attempt: nextAttempt(runsDir, "full", 11), deps: mkDeps() });
  const p2 = writeRun(runsDir, a2);
  assert.equal(a1.run_id, "pr11-full-a1");
  assert.equal(a2.run_id, "pr11-full-a2");
  assert.match(p2, /pr11-full-a2\.json$/);
  const runs = readRuns(runsDir);
  assert.equal(runs.filter((r) => r.pr === 11).length, 2); // both files present, not overwritten
  assert.equal(monthlySpend(runs, "alice", "2026-07"), 4.0); // 2.0 + 2.0, both attempts counted
});

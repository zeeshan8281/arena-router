// Runner orchestration tests (spec §6.1) — all seams mocked, no key/Docker. Run:
//   node --test competition/runner.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { harborArgs, selectTasks, planFor, keyName, runRun } from "./runner.mjs";
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

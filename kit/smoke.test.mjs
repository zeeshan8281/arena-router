// arena smoke/report tests — Harbor spawn injected, no key/Docker. Run:
//   node --test kit/smoke.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscriptCost, buildTrialArtifact, runSmoke, reportDeltas } from "./smoke.mjs";

test("parseTranscriptCost sums assistant usage", () => {
  const jsonl = [
    JSON.stringify({ type: "message_end", message: { role: "assistant", usage: { input: 100, output: 50, cacheRead: 20, cost: { total: 0.0012 } } } }),
    JSON.stringify({ type: "message_end", message: { role: "user", usage: { input: 9999 } } }), // ignored
    "garbage line",
    JSON.stringify({ type: "message_end", message: { role: "assistant", usage: { input: 10, output: 5, cost: { total: 0.0003 } } } }),
  ].join("\n");
  const c = parseTranscriptCost(jsonl);
  assert.equal(c.cost_usd, 0.0015);
  assert.equal(c.input_tokens, 110);
  assert.equal(c.output_tokens, 55);
  assert.equal(c.cache_read_tokens, 20);
});

// build a fake Harbor run dir: result.json + <task>__id/agent/pi-output.jsonl
function fakeRunDir(passByTask, costByTask) {
  const dir = mkdtempSync(join(tmpdir(), "harbor-run-"));
  const reward = {};
  for (const [task, pass] of Object.entries(passByTask)) (reward[pass ? "1.0" : "0.0"] ??= []).push(`${task}__id`);
  writeFileSync(join(dir, "result.json"), JSON.stringify({ stats: { n_trials: 1, n_errors: 0, evals: { e: { reward_stats: { reward } } } } }));
  for (const [task, cost] of Object.entries(costByTask)) {
    mkdirSync(join(dir, `${task}__id`, "agent"), { recursive: true });
    writeFileSync(join(dir, `${task}__id`, "agent", "pi-output.jsonl"),
      JSON.stringify({ type: "message_end", message: { role: "assistant", usage: { input: 100, output: 20, cost: { total: cost } } } }));
  }
  return dir;
}

test("buildTrialArtifact joins pass vector with per-task transcript cost", () => {
  const dir = fakeRunDir({ "fix-git": true, "pypi-server": false }, { "fix-git": 0.4, "pypi-server": 0.1 });
  const art = buildTrialArtifact(dir, 0);
  assert.equal(art.pass_count, 1);
  assert.equal(art.billed_usd, 0.5);
  const fg = art.per_task.find((t) => t.task === "fix-git");
  assert.equal(fg.passed, true);
  assert.equal(fg.cost_usd, 0.4);
});

test("runSmoke writes trial artifacts and medians (transcript cost fallback)", async () => {
  const out = mkdtempSync(join(tmpdir(), "smoke-out-"));
  const dirs = [
    fakeRunDir({ "fix-git": true }, { "fix-git": 0.4 }),
    fakeRunDir({ "fix-git": false }, { "fix-git": 0.6 }),
    fakeRunDir({ "fix-git": true }, { "fix-git": 0.5 }),
  ];
  let i = 0;
  const r = await runSmoke({ key: "sk-or-x", trials: 3, tasks: ["fix-git"], outDir: out, spawn: () => dirs[i++] });
  assert.equal(r.trials.length, 3);
  assert.equal(r.median_pass, 1);
  assert.equal(r.median_cost, 0.5);
  assert.equal(r.trials[0].cost_source, "transcript");
});

test("runSmoke uses the key's usage ledger when a usage reader is provided", async () => {
  const out = mkdtempSync(join(tmpdir(), "smoke-led-"));
  // transcript says 0.4, but the ledger delta says 0.9 — ledger must win
  const dir = fakeRunDir({ "fix-git": true }, { "fix-git": 0.4 });
  const usageSeq = [1.0, 1.9]; // before, after
  let u = 0;
  const r = await runSmoke({
    key: "sk-or-x", trials: 1, tasks: ["fix-git"], outDir: out,
    spawn: () => dir, usage: async () => ({ usage: usageSeq[u++] }),
  });
  assert.equal(r.trials[0].billed_usd, 0.9); // ledger delta, not transcript 0.4
  assert.equal(r.trials[0].cost_source, "ledger");
  assert.equal(r.median_cost, 0.9);
});

test("runSmoke refuses without a key", async () => {
  await assert.rejects(() => runSmoke({ trials: 1, tasks: [], outDir: "/tmp/x", spawn: () => "/x" }), /OPENROUTER_API_KEY/);
});

test("reportDeltas shows change vs previous run", () => {
  const cur = { median_pass: 12, median_cost: 1.0, trials: [{ per_task: [{ task: "fix-git", passed: true, cost_usd: 0.4 }] }] };
  const prev = { median_pass: 10, median_cost: 1.5, trials: [{ per_task: [{ task: "fix-git", passed: true, cost_usd: 0.6 }] }] };
  const out = reportDeltas(cur, prev);
  assert.match(out, /median pass: 12 \(\+2\.0000\)/);
  assert.match(out, /median cost: \$1 \(-0\.5000\)/);
  assert.match(out, /fix-git\t✓\t\$0\.4 \(-0\.2000\)/);
  assert.doesNotMatch(reportDeltas(cur, null), /\(/); // no deltas without a previous run
});

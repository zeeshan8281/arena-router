#!/usr/bin/env node
// Run orchestration (spec §6.1, WP6). Common path for smoke / full / baseline:
//   config gate → budget check → mint capped key → run Harbor (N trials) → parse
//   pass vectors → pull billed cost from the key ledger → integrity → results JSON.
//
// The live seams (OpenRouter Provisioning, Harbor subprocess) are injected as `deps`
// so the orchestration is unit-testable without a key or Docker. The CLI wires the real
// ones. Cost is the key's billed usage (ground truth) — never self-reported.
//
//   node competition/runner.mjs --type smoke|full|baseline --pr <n> --author <login> \
//     --submission submissions/<login> [--model <slug>] [--out <dir>]
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, assertRunnable } from "./scoring/config.mjs";
import { mintKey, keyStatus, deleteKey, keyGenerations } from "./scoring/openrouter.mjs";
import { parseHarborResult } from "./scoring/harbor-results.mjs";
import { checkIntegrity } from "./scoring/integrity.mjs";
import { budgetCheck, readRuns } from "./scoring/budget.mjs";
import { aggregate, smokeGate } from "./scoring/score.mjs";
import { buildRunResult, writeRun } from "./scoring/results.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_IMPORT = "pi_agent:PiAgent";

/** All 89 task IDs (full/baseline run their entirety; smoke uses config.smoke.tasks). */
export function allTaskIds(root = REPO_ROOT) {
  return readFileSync(join(root, "competition/anti-abuse/task-ids.txt"), "utf8")
    .split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
}

export function selectTasks(config, type, allTasks) {
  return type === "smoke" ? config.smoke.tasks : allTasks;
}

export function planFor(config, type) {
  const cap = type === "full" || type === "baseline" ? config.full.cap_usd : config.smoke.cap_usd;
  const trials = type === "smoke" ? config.smoke.trials : config.full.trials;
  return { cap, trials, capExempt: type === "baseline" };
}

export const keyName = (type, pr, attempt = 1) => `pr${pr ?? 0}-${type}-a${attempt}`;

/** Harbor CLI args for one trial (pure — the seam tests assert this exactly). */
export function harborArgs({ dataset, tasks, submission, model, outDir, concurrency }) {
  const args = ["run", "-d", dataset, "--agent-import-path", AGENT_IMPORT, "-m", model, "-n", String(concurrency), "-o", outDir];
  for (const t of tasks) args.push("-t", t);
  if (submission) { /* submission is mounted via PI_SUBMISSION_DIR env, see runTrialLive */ }
  return args;
}

/**
 * Orchestrate a run. `deps` (all injectable):
 *   mint(name, cap) -> {key, hash}
 *   runTrial(key, {tasks, model, submission, trialIndex}) -> harbor result.json object
 *   cost(hash) -> {usage, byok_usage}            (billed so far on the key)
 *   del(hash), now() -> ISO string
 * Returns the §7.1 run-result object (also written to results/runs/ by the CLI).
 */
export async function runRun({ config, type, pr, author, submission, model, deps }) {
  assertRunnable(config, type);
  const allTasks = deps.allTasks ?? allTaskIds();
  const tasks = selectTasks(config, type, allTasks);
  const { cap, trials: nTrials, capExempt } = planFor(config, type);
  const runModel = model || config.models.baseline_model;

  // Budget gate (baseline is cap-exempt, §6.1).
  if (!capExempt) {
    const b = budgetCheck({
      runs: deps.priorRuns ?? [], author, yyyymm: (deps.now?.() ?? "").slice(0, 7),
      cap: config.budget.author_monthly_usd, runType: type, nextCost: cap,
    });
    if (!b.allowed) return voidResult({ type, pr, author, reason: b.reason, now: deps.now });
  }

  const { key, hash } = await deps.mint(keyName(type, pr), cap);
  const trials = [];
  let prevCost = 0;
  try {
    for (let i = 0; i < nTrials; i++) {
      const result = await deps.runTrial(key, { tasks, model: runModel, submission, trialIndex: i });
      const parsed = parseHarborResult(result);
      const c = await deps.cost(hash);
      trials.push({
        pass_vector: parsed.passVector,
        pass_count: parsed.passed,
        n_errors: parsed.n_errors,
        billed_usd: Number((c.usage - prevCost).toFixed(4)),
        generation_ids: [],
        input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
      });
      prevCost = c.usage;
    }
  } finally {
    await deps.del(hash).catch(() => {});
  }

  const finalStatus = await deps.cost(hash).catch(() => ({ byok_usage: 0 }));

  // Pull the key's generation records — the authoritative per-record source for the
  // allowlist check (spec §6.1.6 "every record's model ∈ allowlist"). Fall back to the
  // configured model only if no lister is wired (keeps the check from silently passing).
  const gens = deps.generations ? await deps.generations(hash).catch(() => null) : null;
  const generations = gens ?? [{ model: runModel }];
  const integrity = checkIntegrity({ generations, keyStatus: finalStatus, allowlist: config.models.allowlist });

  // Attach the ledger audit trail. Per-trial attribution needs record timestamps (a
  // follow-up); for single-trial runs (full/baseline, D14) the whole run IS trial[0].
  if (gens && trials.length === 1) {
    trials[0].generation_ids = gens.map((g) => g.id).filter(Boolean);
    trials[0].input_tokens = gens.reduce((s, g) => s + (g.tokens_prompt || 0), 0);
    trials[0].output_tokens = gens.reduce((s, g) => s + (g.tokens_completion || 0), 0);
    trials[0].cache_read_tokens = gens.reduce((s, g) => s + (g.cache_read_tokens || 0), 0);
  }

  const offAllowlist = integrity.flags.some((f) => f.type === "off-allowlist" || f.type === "free-variant");
  const result = buildRunResult({
    runId: keyName(type, pr), runType: type, pr, author,
    entryName: deps.entryName, submissionSha: deps.submissionSha,
    piVersion: config.pi.version, configSha: deps.configSha,
    startedAt: deps.startedAt, finishedAt: deps.now?.(),
    trials,
    validity: {
      byok_zero: (finalStatus.byok_usage ?? 0) === 0,
      models_allowlisted: !offAllowlist,
      post_teardown_records: false, // set by the T+30 re-check job (§6.1.7) when wired
      voided: integrity.void,
      void_reason: integrity.void ? integrity.flags : null,
    },
    anomalyFlags: integrity.flags.filter((f) => f.severity !== "void"),
  });

  if (type === "smoke") {
    result.smoke_gate = smokeGate(result.median_pass_count, config.smoke.gate);
  }
  return result;
}

function voidResult({ type, pr, author, reason, now }) {
  return buildRunResult({
    runId: keyName(type, pr), runType: type, pr, author, startedAt: now?.(), finishedAt: now?.(),
    trials: [], validity: { voided: true, void_reason: reason },
  });
}

// ---- live deps (used by the CLI) ----
function liveDeps({ mgmt, outRoot }) {
  return {
    now: () => new Date().toISOString(),
    mint: (name, cap) => mintKey(mgmt, name, cap),
    del: (hash) => deleteKey(mgmt, hash),
    cost: async (hash) => { const s = await keyStatus(mgmt, hash); return { usage: s.usage, byok_usage: s.byok_usage }; },
    generations: (hash) => keyGenerations(mgmt, hash),
    runTrial: (key, { tasks, model, submission, trialIndex }) => {
      const outDir = join(outRoot, `trial-${trialIndex}`);
      const args = harborArgs({ dataset: loadConfig().benchmark.dataset, tasks, submission, model, outDir, concurrency: loadConfig().benchmark.concurrency });
      const env = { ...process.env, OPENROUTER_API_KEY: key, PI_VENDOR_TARBALL: join(REPO_ROOT, "vendor/pi/pi.tgz"), PI_VENDOR_SHA256: loadConfig().pi.sha256, PI_SUBMISSION_DIR: submission || "" };
      const r = spawnSync("harbor", args, { env, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
      if (r.status !== 0) throw new Error(`harbor exited ${r.status}`);
      // harbor writes <outDir>/<run>/result.json — find the newest
      const runs = readdirSync(outDir).map((d) => join(outDir, d)).sort();
      return JSON.parse(readFileSync(join(runs[runs.length - 1], "result.json"), "utf8"));
    },
  };
}

// ---- CLI ----
async function main(argv) {
  const args = argv.slice(2);
  const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const type = get("--type");
  if (!["smoke", "full", "baseline"].includes(type)) { console.error("--type smoke|full|baseline required"); process.exit(2); }
  const mgmt = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!mgmt) { console.error("OPENROUTER_MANAGEMENT_KEY required"); process.exit(2); }

  const config = loadConfig();
  const pr = get("--pr");
  const author = get("--author", "_baseline");
  const submission = get("--submission");
  const model = get("--model");
  const outRoot = get("--out", join(REPO_ROOT, "results", "harbor", `${type}-pr${pr ?? 0}`));

  const deps = { ...liveDeps({ mgmt, outRoot }), startedAt: new Date().toISOString(), priorRuns: readRuns(join(REPO_ROOT, "results", "runs")) };
  const result = await runRun({ config, type, pr, author, submission, model, deps });
  const path = writeRun(join(REPO_ROOT, "results", "runs"), result);
  console.log(`[runner] ${type} → ${path}  pass=${result.median_pass_count} cost=$${result.median_billed_usd}`);
  if (type === "smoke") console.log(`[runner] smoke gate: ${result.smoke_gate?.pass ? "PASS" : "FAIL"} (${result.median_pass_count} vs ${config.smoke.gate})`);
  process.exit(result.validity?.voided ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);

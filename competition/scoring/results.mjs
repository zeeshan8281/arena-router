#!/usr/bin/env node
// Per-run results + leaderboard generation (spec §7.1–7.2, WP8). A run result is the
// authoritative record: billed dollars (from the OpenRouter ledger), pass vector,
// generation IDs, validity. The leaderboard is regenerated from the committed run files.
//
//   node competition/scoring/results.mjs leaderboard [--runs <dir>] [--bar <N>] [--out <file>]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { leaderboardEntry, rankLeaderboard } from "./score.mjs";
import { readRuns } from "./budget.mjs";
import { loadConfig } from "./config.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Assemble a §7.1 run result. `trials`: [{ pass_vector, pass_count, billed_usd, generation_ids, ... }]. */
export function buildRunResult({ runId, runType, pr, author, entryName, submissionSha, piVersion, configSha, startedAt, finishedAt, trials, validity, anomalyFlags = [] }) {
  const passCounts = trials.map((t) => t.pass_count);
  const costs = trials.map((t) => t.billed_usd);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  return {
    schema_version: 1,
    run_id: runId,
    run_type: runType,
    pr, author,
    entry_name: entryName,
    submission_sha: submissionSha,
    pi_version: piVersion,
    config_sha: configSha,
    started_at: startedAt,
    finished_at: finishedAt,
    trials,
    median_pass_count: median(passCounts),
    median_billed_usd: Number(median(costs).toFixed(4)),
    openrouter_key_name: runId, // key name == run id (§6.1.3 / §7.1)
    validity: validity ?? { voided: false },
    anomaly_flags: anomalyFlags,
  };
}

/** Write a run result to results/runs/<run-id>.json, best-effort minisign it. */
export function writeRun(runsDir, result) {
  mkdirSync(runsDir, { recursive: true });
  const path = join(runsDir, `${result.run_id}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
  signIfConfigured(path);
  return path;
}

// ponytail: signing is optional. Off unless RESULTS_SIGNING_KEY is set AND minisign is
// on PATH — git history + OpenRouter generation IDs already make results auditable, so a
// missing signer is a warning, not a failure. Drop entirely if never wired.
function signIfConfigured(path) {
  const key = process.env.RESULTS_SIGNING_KEY;
  if (!key) return false;
  const r = spawnSync("minisign", ["-S", "-s", key, "-m", path], { encoding: "utf8" });
  if (r.status !== 0) console.warn(`[results] minisign unavailable/failed, leaving ${path} unsigned`);
  return r.status === 0;
}

/**
 * Build the leaderboard object from run objects (spec §7.2): full, non-void runs only;
 * one row per author = their lowest-cost eligible run; rank cheapest-first; below-bar
 * runs listed separately; baseline pinned.
 */
export function generateLeaderboard(runs, { eligibilityBar }) {
  const full = runs.filter((r) => r.run_type === "full" && !r.validity?.voided);
  const baseline = runs.find((r) => r.run_type === "baseline");

  const bestByAuthor = new Map();
  for (const r of full) {
    const entry = leaderboardEntry({
      participant: r.author,
      median_pass: r.median_pass_count,
      median_cost: r.median_billed_usd,
      baseline_pass: eligibilityBar,
      integrity: r.validity?.voided ? { void: true, flags: r.validity } : null,
    });
    entry.entry_name = r.entry_name;
    entry.run_id = r.run_id;
    const prev = bestByAuthor.get(r.author);
    // best eligible run = cheapest among qualified; if none qualified, keep highest pass
    if (!prev || (entry.qualified && (!prev.qualified || entry.cost_usd < prev.cost_usd)) ||
        (!entry.qualified && !prev.qualified && entry.pass > prev.pass)) {
      bestByAuthor.set(r.author, entry);
    }
  }

  const all = [...bestByAuthor.values()];
  const ranked = rankLeaderboard(all.filter((e) => e.qualified));
  const belowBar = all.filter((e) => !e.qualified).sort((a, b) => b.pass - a.pass);
  return {
    schema_version: 1,
    eligibility_bar: eligibilityBar,
    baseline: baseline ? { pass: baseline.median_pass_count, cost_usd: baseline.median_billed_usd, run_id: baseline.run_id } : null,
    ranked,
    below_bar: belowBar,
  };
}

// ---- CLI ----
function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const get = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
  if (cmd !== "leaderboard") {
    console.error("usage: results.mjs leaderboard [--runs <dir>] [--bar <N>] [--out <file>]");
    process.exit(2);
  }
  const runsDir = get("--runs", join(REPO_ROOT, "results", "runs"));
  const barArg = get("--bar", null);
  const bar = barArg != null ? Number(barArg) : loadConfig().full.eligibility_bar;
  const out = get("--out", join(REPO_ROOT, "results", "leaderboard.json"));
  const lb = generateLeaderboard(readRuns(runsDir), { eligibilityBar: bar });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(lb, null, 2) + "\n");
  console.log(`[results] leaderboard → ${out} (${lb.ranked.length} ranked, ${lb.below_bar.length} below bar)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);

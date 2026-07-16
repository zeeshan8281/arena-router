#!/usr/bin/env node
// Per-run results + leaderboard generation (spec §7.1–7.2, WP8). A run result is the
// authoritative record: billed dollars (from the OpenRouter ledger), pass vector,
// generation IDs, validity. The leaderboard is regenerated from the committed run files.
//
//   node competition/scoring/results.mjs leaderboard [--runs <dir>] [--bar <N>] [--out <file>]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

// ---- H4: results integrity ----
// The run files committed to main are the leaderboard's source of truth. readRuns /
// generateLeaderboard TRUST those files as-is — there is no cryptographic verification
// of authorship. The guarantee that a PR cannot forge a favorable run is enforced OUT
// OF BAND: branch protection + CI must reject any PR that writes under results/runs/
// (path containment, owned by the CI agent). Only the trusted CI job may commit run files.
//
// As cheap in-band tamper-evidence we embed a `content_sha256` over the run's own body:
// verifyRun() recomputes it and flags a file whose body no longer matches its recorded
// digest (catches accidental/naive edits — NOT a forgery defense on its own, since an
// attacker who can rewrite the body can recompute the digest; that's what the CI path
// gate is for).

/** sha256 over the run body with `content_sha256` excluded (stable, key-order independent). */
export function hashRun(result) {
  const { content_sha256, ...body } = result;
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/** Write a run result to results/runs/<run-id>.json with a content digest. */
export function writeRun(runsDir, result) {
  mkdirSync(runsDir, { recursive: true });
  const stamped = { ...result, content_sha256: hashRun(result) };
  const path = join(runsDir, `${stamped.run_id}.json`);
  writeFileSync(path, JSON.stringify(stamped, null, 2) + "\n");
  return path;
}

/** Tamper-evidence check: true if the run has no digest (legacy) or its body still matches
 *  the recorded content_sha256. Returns false only when a digest is present but stale. */
export function verifyRun(result) {
  if (!result || !result.content_sha256) return true; // no digest to verify against
  return hashRun(result) === result.content_sha256;
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
    // `full` is already filtered to non-void runs above, so integrity is always clean here
    // (void runs never reach the leaderboard). Passing integrity:null keeps that explicit.
    const entry = leaderboardEntry({
      participant: r.author,
      median_pass: r.median_pass_count,
      median_cost: r.median_billed_usd,
      baseline_pass: eligibilityBar,
      integrity: null,
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

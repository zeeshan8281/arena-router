// Local smoke run + report (spec §6.5). `runSmoke` spawns Harbor per trial with the
// participant's OWN OpenRouter key and writes machine-readable --out artifacts; `report`
// renders them with deltas vs the previous run. The Harbor spawn is injected so the
// artifact assembly + cost parsing are unit-testable without a key or Docker.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseHarborResult, taskNameOf } from "../competition/scoring/harbor-results.mjs";

/** Sum cost + tokens from a pi transcript (pi-output.jsonl). Mirrors the adapter's
 *  populate_context_post_run. Cost is pi's self-report — fine for local iteration
 *  (official scoring uses the OpenRouter ledger, not this). */
export function parseTranscriptCost(jsonl) {
  let cost = 0, input = 0, output = 0, cache_read = 0;
  for (const line of (jsonl || "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let ev;
    try { ev = JSON.parse(s); } catch { continue; }
    const m = ev.message ?? {};
    if (ev.type === "message_end" && m.role === "assistant") {
      const u = m.usage ?? {};
      input += u.input || 0;
      output += u.output || 0;
      cache_read += u.cacheRead || 0;
      cost += (u.cost ?? {}).total || 0;
    }
  }
  return { cost_usd: Number(cost.toFixed(6)), input_tokens: input, output_tokens: output, cache_read_tokens: cache_read };
}

/** Build a per-trial artifact from a Harbor run dir (result.json + <task>__<id>/agent/pi-output.jsonl). */
export function buildTrialArtifact(runDir, trialIndex) {
  const parsed = parseHarborResult(JSON.parse(readFileSync(join(runDir, "result.json"), "utf8")));
  const per_task = [];
  for (const d of readdirSync(runDir, { withFileTypes: true })) {
    if (!d.isDirectory() || !d.name.includes("__")) continue;
    const transcript = join(runDir, d.name, "agent", "pi-output.jsonl");
    const task = taskNameOf(d.name);
    const cost = existsSync(transcript) ? parseTranscriptCost(readFileSync(transcript, "utf8")) : { cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
    per_task.push({ task, passed: parsed.passVector[task] ?? false, ...cost, transcript: existsSync(transcript) ? transcript : null });
  }
  return {
    trial: trialIndex,
    pass_vector: parsed.passVector,
    pass_count: parsed.passed,
    billed_usd: Number(per_task.reduce((s, t) => s + t.cost_usd, 0).toFixed(6)),
    per_task,
  };
}

/**
 * Run the smoke set locally. `spawn(key, {tasks, trialIndex, outDir}) -> runDir` is injected
 * (the CLI passes the real Harbor spawn). Returns { trials, median_pass, median_cost }.
 */
export function runSmoke({ key, trials = 3, tasks, outDir, spawn }) {
  if (!key) throw new Error("OPENROUTER_API_KEY required for a smoke run");
  mkdirSync(outDir, { recursive: true });
  const arts = [];
  for (let i = 0; i < trials; i++) {
    const runDir = spawn(key, { tasks, trialIndex: i, outDir });
    const art = buildTrialArtifact(runDir, i);
    writeFileSync(join(outDir, `trial-${i}.json`), JSON.stringify(art, null, 2) + "\n");
    arts.push(art);
  }
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  return { trials: arts, median_pass: med(arts.map((a) => a.pass_count)), median_cost: Number(med(arts.map((a) => a.billed_usd)).toFixed(6)) };
}

/** Summarize a run dir (its trial-*.json artifacts) → { median_pass, median_cost, trials }. */
export function summarizeRun(runOutDir) {
  const files = readdirSync(runOutDir).filter((f) => /^trial-\d+\.json$/.test(f)).sort();
  const trials = files.map((f) => JSON.parse(readFileSync(join(runOutDir, f), "utf8")));
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  return { median_pass: med(trials.map((t) => t.pass_count)), median_cost: Number(med(trials.map((t) => t.billed_usd)).toFixed(6)), trials };
}

/** Render a cost/pass table with deltas vs the previous run (spec §6.5 `arena report`). */
export function reportDeltas(current, previous) {
  const delta = (c, p) => (p == null ? "" : ` (${c - p >= 0 ? "+" : ""}${Number(c - p).toFixed(4)})`);
  const lines = [
    `median pass: ${current.median_pass}${previous ? delta(current.median_pass, previous.median_pass) : ""}`,
    `median cost: $${current.median_cost}${previous ? delta(current.median_cost, previous.median_cost) : ""}`,
    "",
    "task\tpass\tcost",
  ];
  const cur0 = current.trials?.[0]?.per_task ?? [];
  const prev0 = new Map((previous?.trials?.[0]?.per_task ?? []).map((t) => [t.task, t]));
  for (const t of cur0) {
    lines.push(`${t.task}\t${t.passed ? "✓" : "✗"}\t$${t.cost_usd}${prev0.has(t.task) ? delta(t.cost_usd, prev0.get(t.task).cost_usd) : ""}`);
  }
  return lines.join("\n");
}

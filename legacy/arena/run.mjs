#!/usr/bin/env node
// Local scorer — runs your policy over the PUBLIC dev set of MULTI-STAGE tasks
// using precomputed per-stage outcomes (instant, offline, deterministic). The
// hidden competition set is routed the same way inside the TEE, but with LIVE
// inference + an LLM judge (see src/grader/score.ts) — so this predicts your
// routing, it doesn't reproduce the exact score.
//
//   node --import tsx arena/run.mjs [path/to/policy.ts]
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scorePolicy } from "./score.mjs";

const KIT = dirname(fileURLToPath(import.meta.url));
const policyPath = resolve(process.argv[2] || `${KIT}/policy.template.ts`);
const catalog = JSON.parse(readFileSync(`${KIT}/config/catalog.json`, "utf8"));
const dev = JSON.parse(readFileSync(`${KIT}/dev/devset.json`, "utf8"));

const { decide } = await import(pathToFileURL(policyPath).href);
if (typeof decide !== "function") throw new Error(`${policyPath} must export decide()`);

const r = scorePolicy(decide, dev.tasks, catalog);
const pad = (s, n) => String(s).padEnd(n);
const stages = dev.tasks.reduce((n, t) => n + t.stages.length, 0);

console.log(`\nAutoRouter Arena — local score (${dev.tasks.length} dev tasks · ${stages} stages)\n`);
console.log(pad("task", 6) + pad("route (chosen per stage)", 58) + pad("calls", 6) + pad("quality", 9) + pad("cost", 9) + "oss");
console.log("─".repeat(96));
for (const x of r.rows)
  console.log(pad(x.id, 6) + pad(x.chosen, 58) + pad(x.calls, 6) + pad(x.quality.toFixed(2), 9) + pad("$" + x.cost.toFixed(4), 9) + (x.oss ? "✓" : ""));
console.log("─".repeat(96));
console.log(`mean quality : ${r.mean_quality.toFixed(4)}   (mean over stages, per task)`);
console.log(`mean cost    : $${r.mean_cost.toFixed(4)}   (λ=${r.params.L})`);
if (r.invalid) console.log(`invalid      : ${r.invalid} task(s) scored 0`);
console.log(`\nSCORE = meanQ − λ·meanC + β·ossRate = ${r.score.toFixed(4)}\n`);

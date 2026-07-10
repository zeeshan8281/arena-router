#!/usr/bin/env node
// Local scorer — runs your policy over the PUBLIC dev set using precomputed
// per-model outcomes (instant, offline, deterministic). The hidden competition
// set is scored the exact same way inside the TEE (see src/grader/score.ts).
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

const r = scorePolicy(decide, dev.prompts, catalog);
const pad = (s, n) => String(s).padEnd(n);

console.log(`\nAutoRouter Arena — local score (${dev.prompts.length} dev prompts)\n`);
console.log(pad("prompt", 7) + pad("looper", 12) + pad("chosen", 30) + pad("calls", 6) + pad("quality", 9) + pad("cost", 9) + "oss");
console.log("─".repeat(80));
for (const x of r.rows)
  console.log(pad(x.id, 7) + pad(x.looper, 12) + pad(x.chosen, 30) + pad(x.called, 6) + pad(x.quality.toFixed(2), 9) + pad("$" + x.cost.toFixed(4), 9) + (x.oss ? "✓" : ""));
console.log("─".repeat(80));
console.log(`mean quality : ${r.mean_quality.toFixed(4)}`);
console.log(`mean cost    : $${r.mean_cost.toFixed(4)}   (λ=${r.params.L})`);
console.log(`oss rate     : ${(r.oss_rate * 100).toFixed(1)}%   (β=${r.params.B})`);
if (r.invalid) console.log(`invalid      : ${r.invalid} prompt(s) scored 0`);
console.log(`\nSCORE = meanQ − λ·meanC + β·ossRate = ${r.score.toFixed(4)}\n`);

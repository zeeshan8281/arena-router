#!/usr/bin/env node
// Local scorer for the AutoRouter Arena. Runs your policy over the PUBLIC dev
// set using precomputed per-model outcomes — instant, offline, deterministic.
// The hidden competition set is scored the exact same way (inside the TEE).
//
//   node --import tsx arena/run.mjs [path/to/policy.ts]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const policyPath = resolve(process.argv[2] || `${ROOT}/arena/policy.template.ts`);

const catalog = JSON.parse(readFileSync(`${ROOT}/arena/config/catalog.json`, "utf8"));
const dev = JSON.parse(readFileSync(`${ROOT}/arena/dev/devset.json`, "utf8"));
const { cost_penalty_lambda: LAMBDA, openness_bonus_beta: BETA, confidence_threshold: THRESH } = catalog.scoring;
const byId = Object.fromEntries(catalog.models.map((m) => [m.id, m]));

const { decide } = await import(pathToFileURL(policyPath).href);
if (typeof decide !== "function") throw new Error(`${policyPath} must export decide()`);

// Simulate a looper over precomputed outcomes → {chosen, called[], quality, cost, invalid}
function simulate(dec, outcomes) {
  const cand = (dec?.candidates ?? []).filter((id) => byId[id] && outcomes[id]);
  if (!cand.length) return { invalid: true };
  const price = (id) => byId[id].price_per_call;
  const q = (id) => outcomes[id].quality;
  const conf = (id) => outcomes[id].confidence;

  switch (dec.looper) {
    case "single":
      return { chosen: cand[0], called: [cand[0]] };
    case "confidence": {
      const called = [];
      for (const id of cand) { called.push(id); if (conf(id) >= THRESH) return { chosen: id, called }; }
      return { chosen: called[called.length - 1], called };
    }
    case "ratings": {
      const chosen = [...cand].sort((a, b) => q(b) - q(a))[0]; // best answer wins
      return { chosen, called: cand };
    }
    case "remom": {
      const agg = cand[0];
      const chosen = agg;
      const best = Math.max(...cand.map(q));
      return { chosen, called: [...cand, agg], qualityOverride: Math.min(1, best + 0.03) };
    }
    default:
      return { invalid: true, reason: `unknown looper "${dec?.looper}"` };
  }
}

const rows = [];
let sumQ = 0, sumC = 0, ossHits = 0, invalid = 0;

for (const p of dev.prompts) {
  const view = { id: p.id, text: p.text, signals: p.signals };
  let dec;
  try { dec = decide(view, catalog.models); } catch (e) { dec = null; }
  const sim = simulate(dec, p.outcomes);

  if (sim.invalid) {
    invalid++;
    rows.push({ id: p.id, looper: dec?.looper ?? "—", chosen: "INVALID", q: 0, cost: 0, oss: false });
    continue;
  }
  const quality = sim.qualityOverride ?? p.outcomes[sim.chosen].quality;
  const cost = sim.called.reduce((s, id) => s + byId[id].price_per_call, 0);
  const oss = byId[sim.chosen].open_source;
  sumQ += quality; sumC += cost; if (oss) ossHits++;
  rows.push({ id: p.id, looper: dec.looper, chosen: sim.chosen, called: sim.called.length, q: quality, cost, oss });
}

const N = dev.prompts.length;
const meanQ = sumQ / N, meanC = sumC / N, ossRate = ossHits / N;
const score = meanQ - LAMBDA * meanC + BETA * ossRate;

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nAutoRouter Arena — local score (${N} dev prompts)\n`);
console.log(pad("prompt", 7) + pad("looper", 12) + pad("chosen", 30) + pad("calls", 6) + pad("quality", 9) + pad("cost", 9) + "oss");
console.log("─".repeat(80));
for (const r of rows)
  console.log(pad(r.id, 7) + pad(r.looper, 12) + pad(r.chosen, 30) + pad(r.called ?? "-", 6) + pad(r.q.toFixed(2), 9) + pad("$" + r.cost.toFixed(4), 9) + (r.oss ? "✓" : ""));
console.log("─".repeat(80));
console.log(`mean quality : ${meanQ.toFixed(4)}`);
console.log(`mean cost    : $${meanC.toFixed(4)}   (λ=${LAMBDA})`);
console.log(`oss rate     : ${(ossRate * 100).toFixed(1)}%   (β=${BETA})`);
if (invalid) console.log(`invalid      : ${invalid} prompt(s) scored 0`);
console.log(`\nSCORE = meanQ − λ·meanC + β·ossRate = ${meanQ.toFixed(4)} − ${(LAMBDA * meanC).toFixed(4)} + ${(BETA * ossRate).toFixed(4)} = ${score.toFixed(4)}\n`);

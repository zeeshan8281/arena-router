// Offline check of the live-scoring looper logic: inject a fake Infer so route
// selection (which models get called, which wins) is exercised with no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { score, type ModelCard, type HiddenTask, type Decision } from "../src/grader/score.ts";
import type { Infer } from "../src/grader/infer.ts";

const models: ModelCard[] = [
  { id: "a", tier: "open-free", open_source: true, price_per_call: 0, context: 1, openrouter: "x/a" },
  { id: "b", tier: "proprietary", open_source: false, price_per_call: 0.02, context: 1, openrouter: "x/b" },
];
const conf: Record<string, number> = { a: 0.3, b: 0.9 };   // a below thresh, b above
const qual: Record<string, number> = { a: 0.4, b: 0.8 };   // b is the better answer

// call returns the model id as its "content"; grade looks the id's quality up.
const fake: Infer = {
  async call(id) { return { content: id, confidence: conf[id] ?? null }; },
  async grade(_t, output) { return qual[output] ?? 0; },
};
const params = { cost_penalty_lambda: 4, openness_bonus_beta: 0.15, confidence_threshold: 0.6 };
const task: HiddenTask = { id: "t1", text: "do the thing", signals: {}, rubric: "be right" };

const run = (dec: Decision | null) => score({ t1: dec }, [task], models, params, fake);

test("single calls candidates[0] and grades it", async () => {
  const r = await run({ looper: "single", candidates: ["a"] });
  assert.deepEqual(r.rows[0], { id: "t1", chosen_model: "a", quality: 0.4, cost: 0 });
});

test("confidence escalates past a low-confidence model to a confident one", async () => {
  const r = await run({ looper: "confidence", candidates: ["a", "b"] });
  assert.equal(r.rows[0].chosen_model, "b");     // a (0.3) < 0.6, escalate to b (0.9)
  assert.equal(r.rows[0].quality, 0.8);
  assert.equal(r.rows[0].cost, 0.02);            // paid for BOTH a and b
});

test("ratings fans out and picks the highest-graded answer", async () => {
  const r = await run({ looper: "ratings", candidates: ["a", "b"] });
  assert.equal(r.rows[0].chosen_model, "b");     // qual b > a
  assert.equal(r.rows[0].cost, 0.02);            // both called
});

test("remom chooses the aggregator and pays for the extra synthesis call", async () => {
  const r = await run({ looper: "remom", candidates: ["a", "b"] });
  assert.equal(r.rows[0].chosen_model, "a");     // aggregator = candidates[0]
  assert.equal(r.rows[0].cost, 0.02);            // a + b + a(agg) = 0 + 0.02 + 0
});

test("candidates not in the catalog are invalid and score 0", async () => {
  const r = await run({ looper: "single", candidates: ["zzz"] });
  assert.deepEqual(r.rows[0], { id: "t1", chosen_model: null, quality: 0, cost: 0 });
  assert.equal(r.invalid, 1);
});

test("final score = meanQ - lambda*meanC + beta*ossRate", async () => {
  const r = await run({ looper: "single", candidates: ["a"] });
  // one task: Q=0.4, C=0, oss=1 (a is open) → 0.4 - 4*0 + 0.15*1
  assert.equal(round(r.score), round(0.4 + 0.15));
});

function round(n: number) { return Math.round(n * 1e6) / 1e6; }

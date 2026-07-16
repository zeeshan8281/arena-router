// Offline check of the MULTI-STAGE live-scoring harness: inject a fake Infer so
// per-stage route selection, chaining, cost, and final grading are exercised
// with no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { score, type ModelCard, type HiddenTask, type Stage } from "../src/grader/score.ts";
import type { Infer } from "../src/grader/infer.ts";

const models: ModelCard[] = [
  { id: "a", tier: "tiny", open_source: true, price_per_call: 0.002, context: 1, openrouter: "x/a" },
  { id: "b", tier: "large", open_source: true, price_per_call: 0.02, context: 1, openrouter: "x/b" },
];
const conf: Record<string, number> = { a: 0.3, b: 0.9 };  // a below thresh, b above
const qual: Record<string, number> = { a: 0.4, b: 0.8 };  // b is the better answer

// call returns the model id as content; grade returns that id's quality for a
// single-id output (ratings selection), else 0.9 for the final transcript.
const fake: Infer = {
  async call(id) { return { content: id, confidence: conf[id] ?? null }; },
  async grade(_t, output) { return qual[output] ?? 0.9; },
};
const params = { cost_penalty_lambda: 4, openness_bonus_beta: 0, confidence_threshold: 0.6 };
const stage = (id: string, kind: string): Stage => ({ id, kind, prompt: kind, signals: {} });
const run = (decs: Record<string, any>, stages: Stage[]) =>
  score(decs, [{ id: "t", title: "T", rubric: "r", stages } as HiddenTask], models, params, fake);

test("stages route independently; cost sums across stages; final transcript graded", async () => {
  const r = await run(
    { "t::s1": { looper: "single", candidates: ["a"] }, "t::s2": { looper: "single", candidates: ["b"] } },
    [stage("s1", "plan"), stage("s2", "implement")],
  );
  assert.equal(r.rows[0].stages, 2);
  assert.deepEqual(r.rows[0].chosen_models, ["a", "b"]);
  assert.equal(r.rows[0].cost, 0.022);   // a 0.002 + b 0.02
  assert.equal(r.rows[0].quality, 0.9);  // final transcript grade
});

test("confidence escalates within a stage; ratings picks the best per stage", async () => {
  const r = await run(
    { "t::s1": { looper: "confidence", candidates: ["a", "b"] }, "t::s2": { looper: "ratings", candidates: ["a", "b"] } },
    [stage("s1", "debug"), stage("s2", "test")],
  );
  assert.deepEqual(r.rows[0].chosen_models, ["b", "b"]);          // s1 escalates a→b; s2 rates b>a
  assert.equal(Number(r.rows[0].cost.toFixed(3)), 0.044);        // both stages call [a,b]
});

test("an invalid candidate fails the whole task (quality 0)", async () => {
  const r = await run({ "t::s1": { looper: "single", candidates: ["zzz"] } }, [stage("s1", "plan")]);
  assert.equal(r.rows[0].quality, 0);
  assert.equal(r.invalid, 1);
  assert.deepEqual(r.rows[0].chosen_models, []);
});

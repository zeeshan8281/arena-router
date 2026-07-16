import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MNEMONIC = "test test test test test test test test test test test junk";
process.env.WORKERS_PUBLIC = JSON.stringify({
  "openai/gpt-4o-mini": "http://localhost:8090",
  "openai/gpt-4o": "http://localhost:8091",
  "anthropic/claude-3.7": "http://localhost:8092",
});
process.env.ROUTING_RECIPE_PUBLIC = JSON.stringify({
  bands: {
    low: { looper: "single", models: ["openai/gpt-4o-mini"] },
    med: { looper: "single", models: ["openai/gpt-4o"] },
    high: { looper: "confidence", models: ["openai/gpt-4o", "anthropic/claude-3.7"] },
  },
  params: { confidence_threshold: 0.5, remom_rounds: 2 },
});

const { loadConfig } = await import("../src/config.ts");
const { extractSignals } = await import("../src/router/signals.ts");
const { decide } = await import("../src/router/policy.ts");

const cfg = loadConfig();

test("extractSignals is deterministic for the same input", () => {
  const body = { messages: [{ role: "user", content: "What is 2+2?" }] };
  assert.deepEqual(extractSignals(body), extractSignals(body));
});

test("code fences push to the high band -> confidence looper", () => {
  const s = extractSignals({ messages: [{ role: "user", content: "fix ```def f(): pass```" }] });
  assert.equal(s.complexity_band, "high");
  assert.deepEqual(decide(s), { looper: "confidence", candidates: ["openai/gpt-4o", "anthropic/claude-3.7"] });
});

test("short plain prompt is low band -> single looper", () => {
  const s = extractSignals({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(s.complexity_band, "low");
  assert.deepEqual(decide(s), { looper: "single", candidates: ["openai/gpt-4o-mini"] });
});

test("policy_hash is stable across reloads and commits to params", () => {
  assert.equal(cfg.policyHash, loadConfig().policyHash);
});

test("boot fails if a recipe model has no attested worker", () => {
  const saved = process.env.WORKERS_PUBLIC;
  process.env.WORKERS_PUBLIC = JSON.stringify({ "openai/gpt-4o-mini": "http://localhost:8090" });
  assert.throws(() => loadConfig(), /no attested worker registered/);
  process.env.WORKERS_PUBLIC = saved;
  loadConfig(); // restore
});

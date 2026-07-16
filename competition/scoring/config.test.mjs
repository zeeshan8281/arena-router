// Loads the real competition.toml and checks the subset TOML parser + sentinel guard.
// Run: node --test competition/scoring/config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToml, loadConfig, pendingTbd, assertRunnable, assertAllowlistConsistent } from "./config.mjs";
import { ALLOWLIST } from "./integrity.mjs";

test("real competition.toml round-trips", () => {
  const c = loadConfig();
  assert.equal(c.competition.season, 0);
  assert.equal(c.pi.version, "0.80.9");
  assert.equal(c.pi.sha256.length, 64);
  assert.equal(c.benchmark.concurrency, 4);
  assert.equal(c.models.allowlist.length, 8);
  assert.ok(c.models.allowlist.includes("z-ai/glm-5.2"));
  assert.equal(c.models.ban_free_variants, true);
  assert.equal(c.smoke.tasks.length, 16);
  assert.equal(c.smoke.cap_usd, 1.5);
  assert.equal(c.full.cap_usd, 10);
  assert.equal(c.submission.max_bytes, 1048576);
  assert.equal(c.judge.model, "claude-sonnet-4-6");
});

test("M11: real config's TOML allowlist matches models.json exactly (loadConfig asserts it)", () => {
  const c = loadConfig(); // throws if divergent
  assert.deepEqual([...c.models.allowlist].sort(), [...ALLOWLIST].sort());
  assert.equal(assertAllowlistConsistent(c), true);
});

test("M11: assertAllowlistConsistent throws on divergence", () => {
  const c = loadConfig();
  assert.throws(() => assertAllowlistConsistent(c, [...ALLOWLIST, "sneaky/extra-model"]), /diverged/);
  assert.throws(() => assertAllowlistConsistent({ models: { allowlist: ["only/one"] } }), /diverged/);
});

test("multi-line arrays and inline comments parse", () => {
  const c = parseToml(`
[x]
a = "hello"   # trailing comment
b = 42
flag = true
list = ["one", "two",
  "three"]   # spans lines
`);
  assert.deepEqual(c.x, { a: "hello", b: 42, flag: true, list: ["one", "two", "three"] });
});

test("# inside a string is not treated as a comment", () => {
  const c = parseToml(`[x]\nk = "a#b"`);
  assert.equal(c.x.k, "a#b");
});

test("sentinel guard blocks official runs until frozen", () => {
  const c = loadConfig();
  assert.deepEqual(pendingTbd(c), ["smoke.gate", "full.eligibility_bar"]);
  assert.throws(() => assertRunnable(c, "smoke"), /baseline probe/);
  assertRunnable(c, "baseline"); // exempt — no throw
  c.smoke.gate = 10;
  c.full.eligibility_bar = 40;
  assert.deepEqual(pendingTbd(c), []);
  assertRunnable(c, "full"); // frozen — no throw
});

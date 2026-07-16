// Tests for the OpenRouter ledger parsing (fail-closed money fields + pagination).
// Run: node --test competition/scoring/openrouter.test.mjs
// fetch is mocked via globalThis so no live key / network is needed.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { keyStatus, keyGenerations, selfKeyUsage } from "./openrouter.mjs";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

test("C4: keyStatus parses a finite billed usage + byok_usage", async () => {
  globalThis.fetch = async () => jsonResponse({ data: { usage: 2.5, byok_usage: 0, limit: 10, limit_remaining: 7.5 } });
  const s = await keyStatus("mgmt", "h1");
  assert.equal(s.usage, 2.5);
  assert.equal(s.byok_usage, 0);
});

test("C4: keyStatus THROWS (fails closed) when billed usage is missing/renamed — never $0", async () => {
  // a renamed/absent money field would previously become 0 and auto-win the lowest-cost ranking
  globalThis.fetch = async () => jsonResponse({ data: { cost: 2.5, byok_usage: 0 } }); // 'usage' renamed to 'cost'
  await assert.rejects(() => keyStatus("mgmt", "h1"), /usage/);
});

test("C4: keyStatus THROWS when byok_usage is missing (can't confirm BYOK=0 as money)", async () => {
  globalThis.fetch = async () => jsonResponse({ data: { usage: 1.0 } });
  await assert.rejects(() => keyStatus("mgmt", "h1"), /byok_usage/);
});

test("C4: keyStatus THROWS on a non-numeric usage string", async () => {
  globalThis.fetch = async () => jsonResponse({ data: { usage: "n/a", byok_usage: 0 } });
  await assert.rejects(() => keyStatus("mgmt", "h1"), /usage/);
});

test("C4: selfKeyUsage fails closed on a missing usage field", async () => {
  globalThis.fetch = async () => jsonResponse({ data: { limit: 5 } });
  await assert.rejects(() => selfKeyUsage("sk-inf"), /usage/);
});

test("C4: keyGenerations fails closed if a record's total_cost is non-numeric", async () => {
  globalThis.fetch = async () => jsonResponse({ data: [{ id: "g1", model: "z-ai/glm-5.2", total_cost: "free" }] });
  await assert.rejects(() => keyGenerations("mgmt", "h1"), /total_cost.*not a finite number/);
});

test("H2: keyGenerations follows the cursor across pages (later records not dropped)", async () => {
  const pages = [
    { data: [{ id: "g1", model: "z-ai/glm-5.2", total_cost: 1 }], next_cursor: "c2" },
    { data: [{ id: "g2", model: "openai/gpt-5", total_cost: 2 }], next_cursor: null }, // page 2 has an off-allowlist record
  ];
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(url);
    const hasCursor = url.includes("cursor=");
    return jsonResponse(pages[hasCursor ? 1 : 0]);
  };
  const rows = await keyGenerations("mgmt", "h1");
  assert.deepEqual(rows.map((r) => r.id), ["g1", "g2"]); // both pages pulled
  assert.equal(seen.length, 2);
  assert.ok(seen[1].includes("cursor=c2"));
});

test("H2: keyGenerations stops after one page when no cursor is returned", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonResponse({ data: [{ id: "g1", model: "z-ai/glm-5.2", total_cost: 1 }] }); };
  const rows = await keyGenerations("mgmt", "h1");
  assert.equal(rows.length, 1);
  assert.equal(calls, 1);
});

// Offline checks for judge verdict parsing. Run: node --test competition/anti-abuse/judge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVerdict, buildPrompt, RULE, callJudge, isBlocked } from "./judge.mjs";

test("D12: only clean proceeds", () => {
  assert.equal(isBlocked("clean"), false);
  assert.equal(isBlocked("suspicious"), true);
  assert.equal(isBlocked("violation"), true);
});

test("callJudge hits the Anthropic API shape and parses content", async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { json: async () => ({ content: [{ type: "text", text: '{"verdict":"clean","confidence":0.8,"reasons":[]}' }] }) };
  };
  const v = await callJudge("+ some diff", { apiKey: "sk-ant-x", model: "claude-sonnet-4-6", fetchImpl });
  assert.equal(v.verdict, "clean");
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen.opts.headers["x-api-key"], "sk-ant-x");
  assert.equal(seen.opts.headers["anthropic-version"], "2023-06-01");
  assert.equal(JSON.parse(seen.opts.body).model, "claude-sonnet-4-6");
});

test("parses a well-formed verdict", () => {
  const v = parseVerdict('here you go: {"verdict":"violation","confidence":0.9,"reasons":["hardcodes fix-git"],"generalises":"no"} done');
  assert.equal(v.verdict, "violation");
  assert.equal(v.confidence, 0.9);
  assert.deepEqual(v.reasons, ["hardcodes fix-git"]);
});

test("garbage / no JSON defaults to suspicious (fail cautious)", () => {
  assert.equal(parseVerdict("I think it's fine").verdict, "suspicious");
  assert.equal(parseVerdict("").verdict, "suspicious");
});

test("unknown verdict value is coerced to suspicious", () => {
  assert.equal(parseVerdict('{"verdict":"totally-fine"}').verdict, "suspicious");
});

test("prompt embeds the rule and the diff, header stripped", () => {
  const p = buildPrompt("+ const model = 'mimo-v2.5';");
  assert.ok(p.includes(RULE), "rule injected");
  assert.ok(p.includes("mimo-v2.5"), "diff injected");
  assert.ok(!p.includes("Versioned in-repo"), "doc header stripped");
});

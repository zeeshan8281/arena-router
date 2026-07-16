// Offline checks for judge verdict parsing. Run: node --test competition/anti-abuse/judge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVerdict, buildPrompt, RULE } from "./judge.mjs";

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

// Offline checks for judge verdict parsing. Run: node --test competition/anti-abuse/judge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseVerdict, buildPrompt, RULE, callJudge, isBlocked, verdictSha, cachedVerdict, cacheVerdict, stickyCommentBody, judgeLogLine, judgeLabel, STICKY_MARKER, DIFF_CAP, isTruncated } from "./judge.mjs";

test("verdict SHA cache round-trips and is diff-keyed", () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-cache-"));
  const sha = verdictSha("+ some diff");
  assert.equal(sha.length, 16);
  assert.equal(cachedVerdict(dir, sha), null);
  cacheVerdict(dir, sha, { verdict: "clean", confidence: 0.9 });
  assert.equal(cachedVerdict(dir, sha).verdict, "clean");
  assert.notEqual(verdictSha("+ other diff"), sha);
});

test("surfacing: sticky comment, log line, label", () => {
  const v = { verdict: "violation", confidence: 0.8, reasons: ["hardcodes fix-git"] };
  const body = stickyCommentBody(v);
  assert.match(body, new RegExp(STICKY_MARKER));
  assert.match(body, /violation/);
  assert.match(body, /judge-override/); // appeal note on blocked verdicts
  assert.equal(judgeLabel(v), "judge:violation");
  const line = JSON.parse(judgeLogLine({ pr: 42, sha: "abc", verdict: v, at: "t" }));
  assert.equal(line.pr, 42);
  assert.equal(line.verdict, "violation");
  // clean verdict → no appeal note
  assert.doesNotMatch(stickyCommentBody({ verdict: "clean", confidence: 1, reasons: [] }), /judge-override/);
});

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

test("M4b: parseVerdict emits rationale + evidence and keeps reasons", () => {
  const v = parseVerdict('{"verdict":"violation","confidence":0.9,"reasons":["hardcodes fix-git","branches on task"]}');
  assert.deepEqual(v.evidence, ["hardcodes fix-git", "branches on task"]);
  assert.equal(v.rationale, "hardcodes fix-git; branches on task");
  assert.deepEqual(v.reasons, ["hardcodes fix-git", "branches on task"]); // backward-compat
});

test("M4a: an over-cap diff that the model calls clean is forced to suspicious", async () => {
  const big = "+".repeat(DIFF_CAP + 100);
  assert.equal(isTruncated(big), true);
  const fetchImpl = async () => ({ json: async () => ({ content: [{ type: "text", text: '{"verdict":"clean","confidence":0.99,"reasons":[]}' }] }) });
  const v = await callJudge(big, { apiKey: "k", fetchImpl });
  assert.equal(v.verdict, "suspicious");
  assert.ok(v.reasons.includes("diff-truncated"));
  // and the prompt tells the model it was truncated
  assert.match(buildPrompt(big), /truncated/);
});

test("M4a: a within-cap clean diff stays clean", async () => {
  const small = "+ small diff";
  assert.equal(isTruncated(small), false);
  const fetchImpl = async () => ({ json: async () => ({ content: [{ type: "text", text: '{"verdict":"clean","confidence":0.9,"reasons":[]}' }] }) });
  const v = await callJudge(small, { apiKey: "k", fetchImpl });
  assert.equal(v.verdict, "clean");
});

test("prompt embeds the rule and the diff, header stripped", () => {
  const p = buildPrompt("+ const model = 'mimo-v2.5';");
  assert.ok(p.includes(RULE), "rule injected");
  assert.ok(p.includes("mimo-v2.5"), "diff injected");
  assert.ok(!p.includes("Versioned in-repo"), "doc header stripped");
});

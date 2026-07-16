// Tests for the pure web render helpers. Run: node --test web/render.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLeaderboard, renderRun, esc } from "./render.mjs";

test("esc neutralizes HTML", () => {
  assert.equal(esc('<script>"&'), "&lt;script&gt;&quot;&amp;");
});

test("leaderboard renders ranked rows, baseline, below-bar", () => {
  const html = renderLeaderboard({
    eligibility_bar: 40,
    baseline: { pass: 40, cost_usd: 8 },
    ranked: [{ rank: 1, participant: "bob", entry_name: "b", pass: 41, cost_usd: 3 }],
    below_bar: [{ participant: "carol", entry_name: "c", pass: 30 }],
  });
  assert.match(html, /bob/);
  assert.match(html, /\$3\.0000/);
  assert.match(html, /Below the bar/);
  assert.match(html, /carol/);
});

test("leaderboard handles empty / missing", () => {
  assert.match(renderLeaderboard(null), /No leaderboard/);
  assert.match(renderLeaderboard({ ranked: [], baseline: null }), /not yet run/);
});

test("run detail renders pass grid + validity badge", () => {
  const html = renderRun({
    run_id: "pr1-full-a1", run_type: "full", author: "alice", pi_version: "0.80.9",
    median_pass_count: 42, median_billed_usd: 5,
    trials: [{ pass_vector: { "fix-git": true, "pypi-server": false } }],
    validity: { voided: false }, anomaly_flags: [],
  });
  assert.match(html, /pr1-full-a1/);
  assert.match(html, /class="cell pass"/);
  assert.match(html, /class="cell fail"/);
  assert.match(html, /valid/);
});

test("voided run shows VOID badge", () => {
  const html = renderRun({ run_id: "x", validity: { voided: true, void_reason: "byok" }, trials: [] });
  assert.match(html, /VOID/);
});

const XSS = '<img src=x onerror=alert(1)>';

test("leaderboard escapes hostile participant/entry/rank through full render", () => {
  const html = renderLeaderboard({
    eligibility_bar: 40,
    baseline: { pass: 40, cost_usd: 8 },
    ranked: [{ rank: XSS, participant: XSS, entry_name: XSS, pass: 41, cost_usd: 3 }],
    below_bar: [{ participant: XSS, entry_name: XSS, pass: 30 }],
  });
  assert.doesNotMatch(html, /<img/, "raw <img must not survive into leaderboard HTML");
  assert.match(html, /&lt;img/, "hostile markup must be entity-escaped");
});

test("run detail escapes hostile fields (task names, author, void_reason) through full render", () => {
  const html = renderRun({
    run_id: XSS, run_type: XSS, author: XSS, pi_version: XSS,
    median_pass_count: 1, median_billed_usd: 1,
    trials: [{ pass_vector: { [XSS]: true } }],
    validity: { voided: true, void_reason: XSS },
    anomaly_flags: [],
  });
  assert.doesNotMatch(html, /<img/, "raw <img must not survive into run HTML");
  assert.match(html, /&lt;img/, "hostile markup must be entity-escaped");
});

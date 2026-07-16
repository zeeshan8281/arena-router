// Offline tests for the harbor→scoring parser. Fixture is a REAL Harbor result.json
// from the key-free echo run (fix-git, reward 0.0). Run:
//   node --test competition/scoring/harbor-results.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHarborResult, taskNameOf } from "./harbor-results.mjs";

const echo = JSON.parse(
  readFileSync(new URL("./fixtures/harbor-result-echo.json", import.meta.url)),
);

test("taskNameOf strips the instance suffix", () => {
  assert.equal(taskNameOf("fix-git__m84xLVm"), "fix-git");
  assert.equal(taskNameOf("configure-git-webserver__abc"), "configure-git-webserver");
});

test("real echo result → fix-git not passed, no errors", () => {
  const r = parseHarborResult(echo);
  assert.equal(r.n_trials, 1);
  assert.equal(r.n_errors, 0);
  assert.deepEqual(r.passVector, { "fix-git": false });
  assert.equal(r.passed, 0);
});

test("synthetic pass → counted", () => {
  const r = parseHarborResult({
    n_total_trials: 1,
    stats: {
      n_trials: 1,
      n_errors: 0,
      evals: {
        "pi__glm__tb": {
          reward_stats: { reward: { "1.0": ["fix-git__x"], "0.0": ["pypi-server__y"] } },
        },
      },
    },
  });
  assert.deepEqual(r.passVector, { "fix-git": true, "pypi-server": false });
  assert.equal(r.passed, 1);
});

test("empty / malformed result → zeros, no throw", () => {
  const r = parseHarborResult({});
  assert.equal(r.passed, 0);
  assert.equal(r.n_trials, 0);
  assert.deepEqual(r.passVector, {});
});

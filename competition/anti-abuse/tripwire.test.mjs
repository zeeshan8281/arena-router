// Offline checks for the tripwire scanner. Run: node --test competition/anti-abuse/tripwire.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "./tripwire.mjs";

const IDS = ["fix-git", "password-recovery", "custom-memory-heap-crash"];

const diff = (path, ...added) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n` +
  added.map((l) => "+" + l).join("\n");

test("flags a task ID embedded in an added line", () => {
  const f = scan(diff("skills/router.js", "if (task === 'fix-git') return solution;"), IDS, []);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "task-id");
  assert.equal(f[0].match, "fix-git");
});

test("clean generic routing code produces no findings", () => {
  const f = scan(diff("plugins/cheap.js", "const model = tokens > 1000 ? 'glm-5.2' : 'mimo-v2.5';"), IDS, []);
  assert.equal(f.length, 0);
});

test("substring boundary — 'fix-github' does NOT match 'fix-git'", () => {
  const f = scan(diff("a.js", "const url = 'fix-github-webhook';"), IDS, []);
  assert.equal(f.length, 0);
});

test("catches a curated solution string", () => {
  const f = scan(diff("skills/leak.md", "the flag is FEAL-differential-0xdeadbeef"), IDS, ["FEAL-differential-0xdeadbeef"]);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "solution-string");
});

test("ignores removed/context lines and the tooling's own files", () => {
  const removed = "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-if (task === 'fix-git') {}\n if (task === 'password-recovery') {}";
  assert.equal(scan(removed, IDS, []).length, 0, "removed + context lines are not scanned");
  const own = diff("competition/anti-abuse/task-ids.txt", "custom-memory-heap-crash");
  assert.equal(scan(own, IDS, []).length, 0, "our own task-id list is skipped");
});

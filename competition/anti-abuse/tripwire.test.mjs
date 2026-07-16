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

test("H8b: solution-string matching is case-insensitive", () => {
  const f = scan(diff("skills/leak.md", "the secret is HONEYBEAR"), IDS, ["honeybear"]);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "solution-string");
});

test("H8b: task-id matching is case-insensitive but keeps word boundaries", () => {
  assert.equal(scan(diff("a.js", "if (t === 'FIX-GIT') {}"), IDS, []).length, 1, "case-insensitive id match");
  assert.equal(scan(diff("a.js", "const u = 'FIX-GITHUB-hook';"), IDS, []).length, 0, "boundary preserved (fix-git != fix-github)");
});

test("H8a: an injected content line rendering as `+++ b/...` does not hide a following solution string", () => {
  // Attacker's file content line is `++ b/<skipped path>`; the diff's `+` add-marker
  // makes the RAW diff line `+++ b/<skipped path>`, which the old parser mistook for a
  // real file header and used to re-point `file` at the skipped competition/ dir,
  // dropping the planted answer that followed.
  const d =
    "diff --git a/submissions/alice/x.md b/submissions/alice/x.md\n" +
    "--- a/submissions/alice/x.md\n" +
    "+++ b/submissions/alice/x.md\n" +
    "@@ -0,0 +2 @@\n" +
    "+++ b/competition/anti-abuse/ignore-me\n" +   // added content (`++ b/...`) + `+` marker
    "+the password is honeybear";
  const f = scan(d, IDS, ["honeybear"]);
  assert.equal(f.length, 1, "planted string is still scanned under the real file path");
  assert.equal(f[0].file, "submissions/alice/x.md");
});

test("ignores removed/context lines and the tooling's own files", () => {
  const removed = "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-if (task === 'fix-git') {}\n if (task === 'password-recovery') {}";
  assert.equal(scan(removed, IDS, []).length, 0, "removed + context lines are not scanned");
  const own = diff("competition/anti-abuse/task-ids.txt", "custom-memory-heap-crash");
  assert.equal(scan(own, IDS, []).length, 0, "our own task-id list is skipped");
});

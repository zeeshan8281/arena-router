// Static-checks tests (spec §5.1). Run: node --test competition/anti-abuse/checks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { changedFiles, deriveAuthor, pathContainment, validateManifest, sizeCheck, diffSize, runChecks } from "./checks.mjs";

const diff = (files) =>
  files.map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -0,0 +1 @@\n+x`).join("\n");

// A binary-file change as git renders it: no +++/--- header, just the sentinel line.
const binDiff = (f) => `diff --git a/${f} b/${f}\nnew file mode 100644\nindex 0000000..abc1234\nBinary files /dev/null and b/${f} differ`;

test("changedFiles + deriveAuthor", () => {
  const d = diff(["submissions/alice/config/x.toml", "submissions/alice/skills/y.md"]);
  assert.deepEqual(changedFiles(d).sort(), ["submissions/alice/config/x.toml", "submissions/alice/skills/y.md"]);
  assert.equal(deriveAuthor(changedFiles(d)), "alice");
});

test("path containment blocks vendor edits and cross-author/out-of-dir", () => {
  assert.equal(pathContainment(["vendor/pi/pi.tgz"], "alice").reason, "vendored-pi-modification");
  assert.equal(pathContainment(["pipeline/runner.mjs"], "alice").reason, "path-outside-submission");
  assert.equal(pathContainment(["submissions/bob/x"], "alice").reason, "path-outside-submission");
  assert.equal(pathContainment(["submissions/alice/x"], "alice").ok, true);
});

test("manifest author must match", () => {
  assert.equal(validateManifest('[entry]\nauthor = "alice"', "alice").ok, true);
  assert.equal(validateManifest('[entry]\nauthor = "bob"', "alice").reason, "manifest-author-mismatch");
  assert.equal(validateManifest("nonsense", "alice").reason, "manifest-author-mismatch"); // no [entry] → author absent
});

test("size caps", () => {
  assert.equal(sizeCheck({ fileCount: 201, totalBytes: 10 }).reason, "too-many-files");
  assert.equal(sizeCheck({ fileCount: 5, totalBytes: 2_000_000 }).reason, "submission-too-large");
  assert.equal(sizeCheck({ fileCount: 5, totalBytes: 10 }).ok, true);
});

test("runChecks: clean submission passes, vendor edit blocks, no-author blocks", () => {
  const clean = runChecks(diff(["submissions/alice/config/x.toml"]));
  assert.equal(clean.block, false);
  assert.equal(clean.author, "alice");

  const vendor = runChecks(diff(["submissions/alice/x", "vendor/pi/pi.tgz"]));
  assert.equal(vendor.block, true);
  assert.equal(vendor.reason, "vendored-pi-modification");

  const none = runChecks(diff(["README.md"]));
  assert.equal(none.block, true);
  assert.equal(none.reason, "no-single-submission-author");
});

test("C2a: binary file changes are visible to changedFiles (no +++/--- header)", () => {
  const d = binDiff("vendor/pi/pi.tgz");
  assert.deepEqual(changedFiles(d), ["vendor/pi/pi.tgz"]);
  // and a modified binary (a/ + b/ both present, same path)
  const mod = `diff --git a/submissions/alice/blob.bin b/submissions/alice/blob.bin\nindex 111..222 100644\nBinary files a/submissions/alice/blob.bin and b/submissions/alice/blob.bin differ`;
  assert.deepEqual(changedFiles(mod), ["submissions/alice/blob.bin"]);
});

test("C2a: a backdoored binary under vendor/ BLOCKS (fail closed)", () => {
  const r = runChecks(binDiff("vendor/pi/pi.tgz"), { author: "alice" });
  assert.equal(r.block, true);
  assert.equal(r.reason, "vendored-pi-modification");
});

test("C2a: a binary outside submissions/<author>/ blocks on path", () => {
  const r = runChecks(binDiff("payload.bin"), { author: "alice" });
  assert.equal(r.block, true);
  assert.equal(r.reason, "path-outside-submission");
});

test("H6: diffSize counts files and added bytes", () => {
  const d = diff(["submissions/alice/a.md", "submissions/alice/b.md"]); // each adds "+x"
  const s = diffSize(d);
  assert.equal(s.fileCount, 2);
  assert.equal(s.totalBytes, 2); // two "x" bytes
});

test("H6: runChecks blocks too-many-files", () => {
  const files = Array.from({ length: 201 }, (_, i) => `submissions/alice/f${i}.md`);
  const r = runChecks(diff(files));
  assert.equal(r.block, true);
  assert.equal(r.reason, "too-many-files");
});

test("H6: runChecks blocks oversize submissions", () => {
  const big = `diff --git a/submissions/alice/big.md b/submissions/alice/big.md\n--- a/submissions/alice/big.md\n+++ b/submissions/alice/big.md\n@@ -0,0 +1 @@\n+${"z".repeat(2_000_000)}`;
  const r = runChecks(big);
  assert.equal(r.block, true);
  assert.equal(r.reason, "submission-too-large");
});

test("H6: runChecks blocks manifest-author-mismatch when manifestText supplied", () => {
  const r = runChecks(diff(["submissions/alice/x.toml"]), { author: "alice", manifestText: '[entry]\nauthor = "bob"' });
  assert.equal(r.block, true);
  assert.equal(r.reason, "manifest-author-mismatch");
});

test("runChecks: tripwire fires on an embedded task id", () => {
  // a real TB task id appearing in an added line inside the submission
  const d = diff(["submissions/alice/skills/cheat.md"]).replace("+x", "+handle the fix-git task specially");
  const r = runChecks(d);
  assert.equal(r.block, true);
  assert.equal(r.reason, "tripwire");
});

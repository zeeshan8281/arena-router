// Static-checks tests (spec §5.1). Run: node --test competition/anti-abuse/checks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { changedFiles, deriveAuthor, pathContainment, validateManifest, sizeCheck, runChecks } from "./checks.mjs";

const diff = (files) =>
  files.map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -0,0 +1 @@\n+x`).join("\n");

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

test("runChecks: tripwire fires on an embedded task id", () => {
  // a real TB task id appearing in an added line inside the submission
  const d = diff(["submissions/alice/skills/cheat.md"]).replace("+x", "+handle the fix-git task specially");
  const r = runChecks(d);
  assert.equal(r.block, true);
  assert.equal(r.reason, "tripwire");
});

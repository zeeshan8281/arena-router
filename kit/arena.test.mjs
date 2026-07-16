// Kit CLI command tests (offline). Run: node --test kit/arena.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initCmd, checkCmd, verifyPiCmd, reportCmd } from "./arena.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// a throwaway repo root with just the _template, for init
function scratchRoot() {
  const root = mkdtempSync(join(tmpdir(), "arena-kit-"));
  mkdirSync(join(root, "submissions", "_template"), { recursive: true });
  writeFileSync(join(root, "submissions", "_template", "manifest.toml"), '[entry]\nauthor = "TEMPLATE"\nname = "x"\n');
  return root;
}

test("verify-pi matches the real vendored tarball", () => {
  const r = verifyPiCmd({ root: REPO_ROOT });
  assert.equal(r.ok, true, `expected ${r.expected} got ${r.actual}`);
  assert.equal(r.actual.length, 64);
});

test("init scaffolds the submission dir with author substituted", () => {
  const root = scratchRoot();
  const dir = initCmd("octocat", { root });
  assert.ok(existsSync(join(dir, "manifest.toml")));
  assert.match(readFileSync(join(dir, "manifest.toml"), "utf8"), /author = "octocat"/);
  for (const sub of ["plugins", "skills", "profiles", "config"]) {
    assert.ok(existsSync(join(dir, sub, ".gitkeep")), `${sub} created`);
  }
  assert.throws(() => initCmd("octocat", { root }), /already exists/);
});

test("check passes a clean submission diff, blocks vendor edits", () => {
  const clean = "--- a/submissions/octocat/config/x b/submissions/octocat/config/x\n+++ b/submissions/octocat/config/x\n+ok";
  assert.equal(checkCmd({ diff: clean }).block, false);
  const vendor = "--- a/vendor/pi/pi.tgz b/vendor/pi/pi.tgz\n+++ b/vendor/pi/pi.tgz\n+x";
  assert.equal(checkCmd({ diff: vendor }).reason, "no-single-submission-author");
});

test("report handles no-artifacts gracefully", () => {
  const r = reportCmd({ outDir: join(tmpdir(), "does-not-exist-arena") });
  assert.match(r.text, /no artifacts/);
});

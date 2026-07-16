#!/usr/bin/env node
// Static submission checks (spec §5.1, WP4). Fail-fast, no LLM. Ordered; the first
// failure blocks with a distinct reason. Combines:
//   1. path containment  — changed files ⊆ submissions/<author>/** (also the D20
//      vendored-pi immutability guard: any vendor/ edit blocks with its own reason)
//   2. manifest          — parseable, entry.author == dir == PR author
//   3. size caps         — ≤ max_files, ≤ max_bytes
//   4. tripwire          — the 89 task IDs / solution strings (from tripwire.mjs)
//
//   git diff origin/main...HEAD | node competition/anti-abuse/checks.mjs [--author X]
//   node competition/anti-abuse/checks.mjs --diff some.diff [--author X] [--json]
import { readFileSync } from "node:fs";
import { parseToml } from "../scoring/config.mjs";
import { scan } from "./tripwire.mjs";

const SUB = /^submissions\/([^/]+)\//;

/**
 * File paths touched by a unified diff (added, modified, or deleted).
 *
 * C2a: git renders binary changes as `Binary files a/<p> and b/<p> differ` with NO
 * +++/--- header. Parsing only text hunks made binary files invisible to path
 * containment / the vendor guard / size caps — letting e.g. a backdoored
 * `vendor/pi/pi.tgz` or answers in a `.bin` slip past every static check. We now
 * parse the binary sentinel too so those paths are subject to the same guards.
 */
export function changedFiles(diff) {
  const files = new Set();
  for (const line of diff.split("\n")) {
    const m = line.match(/^(?:\+\+\+|---) [ab]\/(.+)$/);
    if (m && m[1] !== "/dev/null") { files.add(m[1].trim()); continue; }
    // `Binary files a/foo and b/foo differ` (or `.../dev/null` on add/delete).
    const b = line.match(/^Binary files (?:a\/)?(.+?) and (?:b\/)?(.+) differ$/);
    if (b) {
      for (const p of [b[1].trim(), b[2].trim()]) if (p && p !== "/dev/null") files.add(p);
    }
  }
  return [...files];
}

/** Best-effort submission size: file count + total bytes of ADDED text lines.
 *  Binary blobs never contribute bytes here (they aren't in a text diff), which is
 *  fine now that binaries are blocked outside submissions/ and under vendor/ (C2a). */
export function diffSize(diff, files = changedFiles(diff)) {
  let totalBytes = 0;
  for (const line of diff.split("\n")) {
    // added content only: `+...` but not the `+++ ` file header.
    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      totalBytes += Buffer.byteLength(line.slice(1), "utf8");
    }
  }
  return { fileCount: files.length, totalBytes };
}

/** The single submission author a PR touches, or null if none / more than one. */
export function deriveAuthor(files) {
  const authors = new Set();
  for (const f of files) {
    const m = f.match(SUB);
    if (m) authors.add(m[1]);
  }
  return authors.size === 1 ? [...authors][0] : null;
}

/** §5.1.1 — every changed file must live under submissions/<author>/. */
export function pathContainment(files, author) {
  for (const f of files) {
    if (f.startsWith("vendor/")) return { ok: false, reason: "vendored-pi-modification", file: f };
    if (!f.startsWith(`submissions/${author}/`)) return { ok: false, reason: "path-outside-submission", file: f };
  }
  return { ok: true };
}

/** §5.1.2 — manifest parses and its author matches the PR author. */
export function validateManifest(text, author) {
  let cfg;
  try {
    cfg = parseToml(text);
  } catch {
    return { ok: false, reason: "manifest-unparseable" };
  }
  if (cfg?.entry?.author !== author) {
    return { ok: false, reason: "manifest-author-mismatch", detail: `${cfg?.entry?.author} != ${author}` };
  }
  return { ok: true };
}

// competition.toml [submission] defaults, mirrored here because config.mjs is owned by
// another agent. Cross-file dependency: if these ever diverge from competition.toml
// (max_files=200, max_bytes=1048576) they should be read from parseToml instead.
export const SIZE_LIMITS = { maxFiles: 200, maxBytes: 1048576 };

/** §4.2.5 — size caps. */
export function sizeCheck({ fileCount, totalBytes }, { maxFiles = 200, maxBytes = 1048576 } = {}) {
  if (fileCount > maxFiles) return { ok: false, reason: "too-many-files", detail: `${fileCount} > ${maxFiles}` };
  if (totalBytes > maxBytes) return { ok: false, reason: "submission-too-large", detail: `${totalBytes} > ${maxBytes}` };
  return { ok: true };
}

/**
 * Run the static checks over a diff. Returns { block, reason, author, findings }.
 * `opts.manifestText` (if provided) is validated; tripwire always runs.
 */
export function runChecks(diff, opts = {}) {
  const files = changedFiles(diff);
  const author = opts.author ?? deriveAuthor(files);
  if (!author) return { block: true, reason: "no-single-submission-author", author: null, findings: [] };

  const path = pathContainment(files, author);
  if (!path.ok) return { block: true, reason: path.reason, author, findings: [path] };

  // §4.2.5 — file/byte DoS cap (H6: previously dead, sizeCheck was never called).
  const limits = opts.limits ?? SIZE_LIMITS;
  const size = sizeCheck(diffSize(diff, files), limits);
  if (!size.ok) return { block: true, reason: size.reason, author, findings: [size] };

  if (opts.manifestText != null) {
    const man = validateManifest(opts.manifestText, author);
    if (!man.ok) return { block: true, reason: man.reason, author, findings: [man] };
  }

  const trip = scan(diff);
  if (trip.length) return { block: true, reason: "tripwire", author, findings: trip };

  return { block: false, reason: null, author, findings: [] };
}

// ---- CLI ----
function main(argv) {
  const args = argv.slice(2);
  const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const json = args.includes("--json");
  const diffFile = get("--diff");
  const diff = diffFile ? readFileSync(diffFile, "utf8") : readFileSync(0, "utf8");
  const author = get("--author") ?? deriveAuthor(changedFiles(diff));
  // §5.1.2 wiring (H6): best-effort — if the derived author's manifest is on disk,
  // validate it. When run from CI over a checkout this binds manifest author == PR
  // author; when only a bare diff is available it's skipped (the manifest may not be
  // in the diff at all). validateManifest remains callable/tested regardless.
  let manifestText;
  if (author) {
    try { manifestText = readFileSync(`submissions/${author}/manifest.toml`, "utf8"); } catch { /* not on disk */ }
  }
  const res = runChecks(diff, { ...(author ? { author } : {}), ...(manifestText != null ? { manifestText } : {}) });
  if (json) console.log(JSON.stringify(res, null, 2));
  else console.log(res.block ? `BLOCK: ${res.reason}` : `OK (author=${res.author})`);
  process.exit(res.block ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);

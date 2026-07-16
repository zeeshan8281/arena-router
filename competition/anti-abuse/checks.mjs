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

/** File paths touched by a unified diff (added, modified, or deleted). */
export function changedFiles(diff) {
  const files = new Set();
  for (const line of diff.split("\n")) {
    const m = line.match(/^(?:\+\+\+|---) [ab]\/(.+)$/);
    if (m && m[1] !== "/dev/null") files.add(m[1].trim());
  }
  return [...files];
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
  const author = get("--author");
  const res = runChecks(diff, author ? { author } : {});
  if (json) console.log(JSON.stringify(res, null, 2));
  else console.log(res.block ? `BLOCK: ${res.reason}` : `OK (author=${res.author})`);
  process.exit(res.block ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);

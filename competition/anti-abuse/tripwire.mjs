#!/usr/bin/env node
// Static tripwire — ci-anti-abuse §3a, step 1. Scans a submission diff for the
// 89 Terminal-Bench task IDs and curated solution strings, to catch lazy answer-
// embedding (the task-agnosticity rule). Free, runs on every push. It is a
// TRIAGE signal: findings label a PR for human review — they do not auto-fail.
//
//   git diff origin/main...HEAD | node competition/anti-abuse/tripwire.mjs
//   node competition/anti-abuse/tripwire.mjs --diff some.diff [--json]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const loadList = (f) => {
  try { return readFileSync(join(HERE, f), "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")); }
  catch { return []; }
};

export const TASK_IDS = loadList("task-ids.txt");
export const SOLUTION_STRINGS = loadList("solution-strings.txt");

// competition tooling is not a submission — never scan our own lists against themselves
const SKIP_PATH = /^competition\/anti-abuse\//;

/** Pull the ADDED lines of a unified diff, tagged with their file path. */
export function addedLines(diff) {
  const out = [];
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) { file = line.slice(4).replace(/^b\//, "").trim(); continue; }
    if (line.startsWith("+") && !line.startsWith("+++")) out.push({ file, text: line.slice(1) });
  }
  return out;
}

/** Find task-id / solution-string references in a diff's added lines. */
export function scan(diff, taskIds = TASK_IDS, solutionStrings = SOLUTION_STRINGS) {
  // match a kebab-case id only on non-alphanumeric-dash boundaries (avoid substring false hits)
  const idRes = taskIds.map((id) => [id, new RegExp(`(^|[^A-Za-z0-9-])${id}($|[^A-Za-z0-9-])`)]);
  const findings = [];
  for (const { file, text } of addedLines(diff)) {
    if (!file || SKIP_PATH.test(file)) continue;
    for (const [id, re] of idRes) if (re.test(text)) findings.push({ file, type: "task-id", match: id, line: text.trim().slice(0, 120) });
    for (const s of solutionStrings) if (text.includes(s)) findings.push({ file, type: "solution-string", match: s.slice(0, 48), line: text.trim().slice(0, 120) });
  }
  return findings;
}

// ── CLI (only when run directly, so tests can import scan without reading stdin) ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--diff");
  const diff = i >= 0 ? readFileSync(process.argv[i + 1], "utf8") : readFileSync(0, "utf8");
  const findings = scan(diff);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ clean: findings.length === 0, count: findings.length, findings }, null, 2));
  } else if (!findings.length) {
    console.log("✓ tripwire clean — no benchmark task IDs or solution strings in the submission diff");
  } else {
    console.log(`✗ tripwire — ${findings.length} match(es) violate the task-agnosticity rule:\n`);
    for (const f of findings) console.log(`  [${f.type}] ${f.match}\n     ${f.file}:  ${f.line}`);
    console.log(`\n→ labels the PR for human review (triage, not an auto-disqualify).`);
  }
  process.exit(findings.length ? 1 : 0);
}

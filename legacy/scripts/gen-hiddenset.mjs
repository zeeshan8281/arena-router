#!/usr/bin/env node
// Generate the arena HIDDEN set — MULTI-STAGE software-engineering tasks. Each
// task is an ordered list of stages (plan → implement → test/review). The
// grader routes each stage with the participant's policy, runs the chosen
// model on the stage prompt WITH prior-stage output as context, chains them,
// and an LLM judge grades the final transcript against `rubric`.
//
// `signals` per stage are COMPUTED from the prompt (same band rules as the
// router) so the file is honest and regenerable. Stage `kind` is the routing
// hint the policy keys on (plan/implement/test/review/debug).
//
//   node scripts/gen-hiddenset.mjs   → arena/hidden/hiddenset.json (gitignored) + HIDDEN_SET_B64
import { mkdirSync, writeFileSync } from "node:fs";

const TASKS = [
  {
    id: "rl", title: "Token-bucket rate limiter",
    stages: [
      { id: "s1", kind: "plan",
        prompt: "Design a token-bucket rate limiter. Describe the fields it needs (capacity, current tokens, refill rate, last-refill timestamp) and the algorithm for allow(): how tokens refill from elapsed time and when a request is admitted." },
      { id: "s2", kind: "implement",
        prompt: "Implement it in Python as a class `RateLimiter(capacity: float, refill_per_sec: float)` with `allow(self) -> bool` that admits a request iff a token is available, refilling tokens from wall-clock elapsed time (capped at capacity). Return only the code." },
      { id: "s3", kind: "review",
        prompt: "Review the implementation for correctness — time handling, capping tokens at capacity, and thread-safety. List any real bugs and give a corrected final version if needed." },
    ],
    rubric: "The final solution must implement a correct token bucket: (1) tokens refill as elapsed_time * refill_per_sec, capped at capacity; (2) allow() consumes one token and returns True only when >=1 token is available, else False; (3) elapsed time uses a real/monotonic clock; (4) the review raises at least one genuine concern (thread-safety, capping at capacity, or monotonic clock). Full credit if all four hold. Deduct 0.25 per missing item. 0 if allow() logic is fundamentally wrong.",
  },
  {
    id: "csv", title: "CSV parser with quoted fields",
    stages: [
      { id: "s1", kind: "plan",
        prompt: "Plan a CSV parser that handles double-quoted fields containing commas and returns a list of dicts keyed by the header row. List the tricky cases it must handle." },
      { id: "s2", kind: "implement",
        prompt: "Implement `parse_csv(text: str) -> list[dict]` in Python: the first line is the header; fields may be wrapped in double quotes, and a quoted field may contain commas. Return one dict per data row keyed by the header. Do NOT use the csv module. Return only the code." },
      { id: "s3", kind: "test",
        prompt: "Write 3 assert-based test cases for parse_csv covering: a quoted field containing a comma, an empty field, and a normal row." },
    ],
    rubric: "Final solution: (1) parse_csv respects double-quoted fields that contain commas (NOT a naive split(',')); (2) returns a list of dicts keyed by the header; (3) handles empty fields; (4) the tests actually exercise a quoted-comma field and an empty field. Full credit if all four hold. Deduct 0.25 per missing item. 0 if it just does text.split(',').",
  },
  {
    id: "bug", title: "Fix and harden a binary search",
    stages: [
      { id: "s1", kind: "debug",
        prompt: "This binary search has a bug that can infinite-loop:\n```python\ndef bsearch(a, x):\n    lo, hi = 0, len(a)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if a[mid] < x: lo = mid\n        elif a[mid] > x: hi = mid\n        else: return mid\n    return -1\n```\nIdentify the bug and give the corrected function." },
      { id: "s2", kind: "test",
        prompt: "Write assert-based tests proving the fixed bsearch works: element present, element absent, empty list, and first/last element." },
      { id: "s3", kind: "review",
        prompt: "Review the final function and tests. State whether the fix handles duplicates and out-of-range targets correctly, and whether the tests give adequate edge-case coverage." },
    ],
    rubric: "(1) Correctly identifies the infinite-loop bug: `lo = mid` must become `lo = mid + 1` (the low pointer never advances when a[mid] < x); (2) the corrected function is a valid binary search returning an index or -1; (3) tests cover present, absent, and empty-list cases; (4) the review addresses edge cases correctly. Full credit if all four hold. Deduct 0.25 per missing item. 0 if the bug is misidentified or the fix is wrong.",
  },
];

// signal extraction — mirrors src/router/signals.ts band logic
function signals(text) {
  const token_estimate = Math.ceil(text.length / 4);
  const questions = (text.match(/\?/g) || []).length;
  const has_code = /```/.test(text) || /\b(function|class|def|import|SELECT|assert)\b/.test(text);
  let complexity_band;
  if (has_code || token_estimate > 400 || questions >= 3) complexity_band = "high";
  else if (token_estimate > 120 || questions >= 1) complexity_band = "med";
  else complexity_band = "low";
  return { token_estimate, detected_lang: "en", complexity_band, has_code };
}

const tasks = TASKS.map((t) => ({
  id: t.id, title: t.title, rubric: t.rubric,
  stages: t.stages.map((s) => ({ id: s.id, kind: s.kind, prompt: s.prompt, signals: signals(s.prompt) })),
}));

mkdirSync("arena/hidden", { recursive: true });
const json = JSON.stringify({ tasks }, null, 2);
writeFileSync("arena/hidden/hiddenset.json", json);

console.log(`wrote arena/hidden/hiddenset.json — ${tasks.length} tasks, ${tasks.reduce((n, t) => n + t.stages.length, 0)} stages\n`);
console.log("task  stage  kind        band   code");
for (const t of tasks) for (const s of t.stages)
  console.log(`${t.id.padEnd(5)} ${s.id}     ${s.kind.padEnd(11)} ${s.signals.complexity_band.padEnd(6)} ${s.signals.has_code}`);
console.log("\nHIDDEN_SET_B64:\n");
console.log(Buffer.from(json).toString("base64"));

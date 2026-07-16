#!/usr/bin/env node
// LLM judge — ci-anti-abuse §3a, step 2. Runs on the submission diff every push
// with a cheap model. Triage only: clean → proceed · suspicious → proceed +
// label for human review · violation → block pending maintainer override. Final
// call on suspicious/violation is always human.
//
//   git diff origin/main...HEAD | node competition/anti-abuse/judge.mjs [--json]
//   env: OPENROUTER_API_KEY (required to run) · JUDGE_MODEL (default gpt-4o-mini)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// The bright-line rule (ci-anti-abuse §3a), kept next to the prompt it feeds.
export const RULE =
  "Submissions may not contain task-specific content — no Terminal-Bench task " +
  "names or IDs, no solution strings/answers, and no benchmark-conditional " +
  "branching (e.g. 'if the prompt mentions <X>, do <Y>'). The harness must be " +
  "generally useful, not tuned to the 89 scored tasks.";

/** Extract the judge's JSON verdict from a model reply; safe defaults on garbage. */
export function parseVerdict(text) {
  const m = (text || "").match(/\{[\s\S]*\}/);
  if (!m) return { verdict: "suspicious", confidence: 0, reasons: ["unparseable judge reply"], generalises: "" };
  try {
    const v = JSON.parse(m[0]);
    const verdict = ["clean", "suspicious", "violation"].includes(v.verdict) ? v.verdict : "suspicious";
    return { verdict, confidence: Number(v.confidence) || 0, reasons: Array.isArray(v.reasons) ? v.reasons : [], generalises: v.generalises || "" };
  } catch {
    return { verdict: "suspicious", confidence: 0, reasons: ["invalid judge JSON"], generalises: "" };
  }
}

export function buildPrompt(diff) {
  return readFileSync(join(HERE, "judge-prompt.md"), "utf8")
    .split("---\n").slice(1).join("---\n")          // strip the doc header, keep the prompt body
    .replace("{{RULE}}", RULE)
    .replace("{{DIFF}}", diff.slice(0, 60000));      // cap the diff sent to the judge
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { console.error("OPENROUTER_API_KEY required to run the judge"); process.exit(2); }
  const model = process.env.JUDGE_MODEL || "openai/gpt-4o-mini";
  const i = process.argv.indexOf("--diff");
  const diff = i >= 0 ? readFileSync(process.argv[i + 1], "utf8") : readFileSync(0, "utf8");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-title": "arena-harness-judge" },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: buildPrompt(diff) }] }),
  });
  const data = await res.json();
  const v = parseVerdict(data?.choices?.[0]?.message?.content ?? "");

  if (process.argv.includes("--json")) console.log(JSON.stringify({ model, ...v }, null, 2));
  else {
    const mark = { clean: "✓", suspicious: "△", violation: "✗" }[v.verdict];
    console.log(`${mark} judge verdict: ${v.verdict}  (confidence ${v.confidence})  · model ${model}`);
    for (const r of v.reasons) console.log(`   - ${r}`);
    if (v.generalises) console.log(`   generalises? ${v.generalises}`);
  }
  process.exit(v.verdict === "violation" ? 1 : 0);   // suspicious still proceeds (CI labels it)
}

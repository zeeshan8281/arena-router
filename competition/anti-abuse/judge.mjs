#!/usr/bin/env node
// LLM judge — spec §5.2 (D13). Runs on the submission diff every push. Verdict:
// clean → proceed · suspicious | violation → BLOCK (D12; appeal via the maintainer
// `judge-override` label). The judge only ever reads the diff, never PR code (§3).
//
//   git diff origin/main...HEAD | node competition/anti-abuse/judge.mjs [--json]
//   env: ANTHROPIC_API_KEY (required) · JUDGE_MODEL (default claude-sonnet-4-6)
// D13: Anthropic Claude Sonnet 4.6, deliberately OFF the competition model pool.
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

/** blocked verdicts (D12): only `clean` proceeds. */
export const isBlocked = (verdict) => verdict !== "clean";

/** Call the Anthropic Messages API on a diff and return a parsed verdict.
 *  Pure w.r.t. the network via the injectable `fetchImpl` (tests pass a stub). */
export async function callJudge(diff, { apiKey, model = "claude-sonnet-4-6", fetchImpl = fetch } = {}) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: "user", content: buildPrompt(diff) }],
    }),
  });
  const data = await res.json();
  const text = Array.isArray(data?.content) ? data.content.map((b) => b.text || "").join("") : "";
  return parseVerdict(text);
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.error("ANTHROPIC_API_KEY required to run the judge"); process.exit(2); }
  const model = process.env.JUDGE_MODEL || "claude-sonnet-4-6";
  const i = process.argv.indexOf("--diff");
  const diff = i >= 0 ? readFileSync(process.argv[i + 1], "utf8") : readFileSync(0, "utf8");

  const v = await callJudge(diff, { apiKey: key, model });

  if (process.argv.includes("--json")) console.log(JSON.stringify({ model, ...v }, null, 2));
  else {
    const mark = { clean: "✓", suspicious: "△", violation: "✗" }[v.verdict];
    console.log(`${mark} judge verdict: ${v.verdict}  (confidence ${v.confidence})  · model ${model}`);
    for (const r of v.reasons) console.log(`   - ${r}`);
    if (v.generalises) console.log(`   generalises? ${v.generalises}`);
  }
  process.exit(isBlocked(v.verdict) ? 1 : 0);   // D12: suspicious + violation both block
}

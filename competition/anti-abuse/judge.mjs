#!/usr/bin/env node
// LLM judge — spec §5.2 (D13). Runs on the submission diff every push. Verdict:
// clean → proceed · suspicious | violation → BLOCK (D12; appeal via the maintainer
// `judge-override` label). The judge only ever reads the diff, never PR code (§3).
//
//   git diff origin/main...HEAD | node competition/anti-abuse/judge.mjs [--json]
//   env: ANTHROPIC_API_KEY (required) · JUDGE_MODEL (default claude-sonnet-4-6)
// D13: Anthropic Claude Sonnet 4.6, deliberately OFF the competition model pool.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
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

// ── surfacing + verdict cache (spec §5.3) ──

/** Short SHA of the diff — keys the verdict cache so an identical diff isn't re-rolled
 *  (flapping guard, §5.3). */
export const verdictSha = (diff) => createHash("sha256").update(diff).digest("hex").slice(0, 16);

/** Cached verdict for a diff SHA, or null. */
export function cachedVerdict(cacheDir, sha) {
  const p = join(cacheDir, `${sha}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
export function cacheVerdict(cacheDir, sha, verdict) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, `${sha}.json`), JSON.stringify(verdict));
  return verdict;
}

/** Sticky PR-comment body (§5.3): a hidden marker lets CI find-and-update one comment. */
export const STICKY_MARKER = "<!-- arena-judge -->";
export function stickyCommentBody(v) {
  const mark = { clean: "✅", suspicious: "⚠️", violation: "⛔" }[v.verdict] || "❓";
  const out = [STICKY_MARKER, `${mark} **Harness judge: \`${v.verdict}\`** (confidence ${v.confidence})`];
  if (v.reasons?.length) out.push("", ...v.reasons.map((r) => `- ${r}`));
  if (isBlocked(v.verdict)) out.push("", "_Blocked pending review — a maintainer can apply `judge-override` to appeal (spec §5.3)._");
  return out.join("\n");
}

/** One appended line for results/judge-log.jsonl (§5.3, admin audit). */
export const judgeLogLine = ({ pr, sha, verdict, at, overriddenBy = null }) =>
  JSON.stringify({ pr, sha, verdict: verdict.verdict, confidence: verdict.confidence, reasons: verdict.reasons ?? [], overridden_by: overriddenBy, at: at ?? null });

/** PR label for the verdict (§5.3). */
export const judgeLabel = (v) => `judge:${v.verdict}`;

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

// ────────────────────────────────────────────────────────────────────────
//  YOUR SUBMISSION.  Implement decide(). This is the only file you submit.
//
//  Rules (enforced by the grader sandbox):
//    • Pure function. No network, no fs, no clock, no randomness.
//    • You only pick models from `models`; the grader runs them for you.
//    • Must return within the per-call timeout.
//
//  Tasks are MULTI-STAGE (e.g. plan → implement → test → review). decide() is
//  called once per stage — route each stage independently. `prompt.stage.kind`
//  tells you which step it is. Every model is open + free, so the game is
//  QUALITY vs COMPUTE (price_per_call = compute-cost proxy):
//    score = mean_quality − λ·mean_cost           (see COMPETITION.md)
//    → cheap stages to a small model; hard/code stages to a stronger one, only
//      when the extra quality beats the compute it costs.
// ────────────────────────────────────────────────────────────────────────
import type { PromptView, ModelCard, Decision } from "./types";

export function decide(prompt: PromptView, models: ModelCard[]): Decision {
  const ladder = [...models].sort((a, b) => a.price_per_call - b.price_per_call).map((m) => m.id);
  const cheapest = ladder[0];
  const strongest = ladder[ladder.length - 1];
  const coder = models.find((m) => m.tier === "code")?.id;
  const kind = prompt.stage?.kind;

  // Coding stages → a code specialist, escalating to the strongest if unsure.
  if (kind === "implement" || kind === "debug" || prompt.signals.has_code) {
    return { looper: "confidence", candidates: [coder ?? cheapest, strongest].filter(Boolean) as string[] };
  }

  // Reasoning-heavy stages (design/verify) → a mid model, single shot.
  if (kind === "plan" || kind === "review" || kind === "test") {
    const mid = ladder[Math.min(2, ladder.length - 1)];
    return { looper: "single", candidates: [mid] };
  }

  // Anything else → cheapest, single shot. Lowest compute.
  return { looper: "single", candidates: [cheapest] };
}

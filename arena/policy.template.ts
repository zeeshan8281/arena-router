// ────────────────────────────────────────────────────────────────────────
//  YOUR SUBMISSION.  Implement decide(). This is the only file you submit.
//
//  Rules (enforced by the grader sandbox):
//    • Pure function. No network, no fs, no clock, no randomness.
//    • You only pick models from `models`; the grader runs them for you.
//    • Must return within the per-call timeout.
//
//  Every model is open-source and free to call — so the game is QUALITY vs
//  COMPUTE. price_per_call is a compute-cost proxy (bigger model = more).
//    score = mean_quality − λ·mean_cost           (see COMPETITION.md)
//    → route the smallest model that's good enough; escalate to a bigger one
//      only when the extra quality outweighs the compute it costs.
// ────────────────────────────────────────────────────────────────────────
import type { PromptView, ModelCard, Decision } from "./types";

export function decide(prompt: PromptView, models: ModelCard[]): Decision {
  // cheapest (smallest) → most expensive (largest) compute
  const byCost = [...models].sort((a, b) => a.price_per_call - b.price_per_call);
  const cheapest = byCost[0].id;
  const ladder = byCost.map((m) => m.id);

  // Hard prompt: start cheap and escalate up the ladder only if the small
  // model isn't confident. You pay for a bigger call only when it escalates.
  if (prompt.signals.complexity_band === "high" || prompt.signals.has_code) {
    return { looper: "confidence", candidates: ladder };
  }

  // Easy/medium: smallest model, single shot. Lowest compute.
  return { looper: "single", candidates: [cheapest] };
}

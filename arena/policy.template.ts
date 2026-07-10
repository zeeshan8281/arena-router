// ────────────────────────────────────────────────────────────────────────
//  YOUR SUBMISSION.  Implement decide(). This is the only file you submit.
//
//  Rules (enforced by the grader sandbox):
//    • Pure function. No network, no fs, no clock, no randomness.
//    • You only pick models from `models`; the grader runs them for you.
//    • Must return within the per-call timeout.
//
//  Goal: highest quality per dollar, and lean on open / free models.
//    score = mean_quality − λ·mean_cost + β·oss_rate     (see COMPETITION.md)
//    → free OSS models cost nothing AND earn the openness bonus, so use them
//      whenever they're good enough; only spend on proprietary when it pays.
// ────────────────────────────────────────────────────────────────────────
import type { PromptView, ModelCard, Decision } from "./types";

export function decide(prompt: PromptView, models: ModelCard[]): Decision {
  const freeOpen = models.filter((m) => m.open_source && m.price_per_call === 0).map((m) => m.id);
  const strongest = models.find((m) => !m.open_source)?.id ?? models[models.length - 1].id;

  // Hard prompt: start on a free model, escalate to a strong one only if the
  // free answer isn't confident enough. You pay for the strong call only when
  // the confidence looper actually escalates.
  if (prompt.signals.complexity_band === "high" || prompt.signals.has_code) {
    return { looper: "confidence", candidates: [...freeOpen, strongest] };
  }

  // Easy/medium: a free OSS model, single shot. Zero cost, full openness bonus.
  return { looper: "single", candidates: [freeOpen[0] ?? models[0].id] };
}

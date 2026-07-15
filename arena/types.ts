// The contract between a participant's policy and the grader.
// Everything here is what your decide() sees and returns. Nothing else.

export interface Signals {
  token_estimate: number;                 // chars/4 heuristic
  detected_lang: string;                  // "en", "zh", ...
  complexity_band: "low" | "med" | "high";
  has_code: boolean;                      // fenced code / code keywords present
}

export interface PromptView {
  id: string;
  text: string;                           // the current stage's instruction (your router may read it)
  signals: Signals;                       // precomputed, deterministic
  // Multi-stage tasks call decide() once per stage. `stage` tells you which
  // step you're routing (plan / implement / test / review / debug ...), so you
  // can send code stages to a code model, planning to a cheap one, etc.
  // Routing must depend on this metadata only — not on prior stage output
  // (you don't see it; the grader feeds it to the model as context).
  stage?: { kind: string; index: number; total: number };
}

export interface ModelCard {
  id: string;
  tier: "tiny" | "small" | "mid" | "code" | "large";  // capability class — a routing hint
  open_source: boolean;                   // every arena model is open; kept for future closed entrants
  price_per_call: number;                 // COMPUTE-cost proxy (bigger model = more), the thing you minimize
  context: number;                        // max context tokens
}

export type Looper = "single" | "confidence" | "ratings" | "remom";

export interface Decision {
  looper: Looper;
  candidates: string[];                   // model ids from the catalog, in preference order
}

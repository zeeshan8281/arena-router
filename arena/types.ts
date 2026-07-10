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
  text: string;                           // the prompt (your router may read it)
  signals: Signals;                       // precomputed, deterministic
}

export interface ModelCard {
  id: string;
  tier: "open-free" | "open-paid" | "proprietary";
  open_source: boolean;
  price_per_call: number;                 // USD; open-free models are 0
  context: number;                        // max context tokens
}

export type Looper = "single" | "confidence" | "ratings" | "remom";

export interface Decision {
  looper: Looper;
  candidates: string[];                   // model ids from the catalog, in preference order
}

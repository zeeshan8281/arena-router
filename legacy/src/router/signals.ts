export interface Signals {
  token_estimate: number;
  detected_lang: string;
  complexity_band: "low" | "med" | "high";
}

export interface ChatBody {
  messages?: { role: string; content: string }[];
  max_tokens?: number;
}

/**
 * Pure, deterministic signal extraction — same input always yields the same
 * signals, or the receipt would not be reproducible. No network, no tokenizer
 * service, no model calls.
 */
export function extractSignals(body: ChatBody): Signals {
  const text = (body.messages ?? []).map((m) => m.content ?? "").join("\n");

  // ponytail: chars/4 token heuristic — good enough for banding, no tokenizer.
  const token_estimate = Math.ceil(text.length / 4);

  return {
    token_estimate,
    detected_lang: detectLang(text),
    complexity_band: complexityBand(text, token_estimate),
  };
}

// ponytail: script-range heuristic, not a full language detector.
// Covers the common non-latin scripts; everything else falls back to "en".
function detectLang(text: string): string {
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  return "en";
}

function complexityBand(text: string, tokens: number): "low" | "med" | "high" {
  const hasCode = /```/.test(text) || /\b(function|class|def|import|SELECT)\b/.test(text);
  const questions = (text.match(/\?/g) ?? []).length;

  if (hasCode || tokens > 400 || questions >= 3) return "high";
  if (tokens > 120 || questions >= 1) return "med";
  return "low";
}

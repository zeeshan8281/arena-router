import { verifyMessage } from "ethers";

// Must match src/grader/score.ts canonicalize (recursive key sort).
export const canonicalize = (v: unknown): string => JSON.stringify(sortDeep(v));
function sortDeep(x: any): any {
  if (Array.isArray(x)) return x.map(sortDeep);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortDeep(x[k])]));
  return x;
}

export function verifyReceipt(receipt: unknown, signature: string, grader: string): { ok: boolean; recovered: string } {
  try {
    const recovered = verifyMessage(canonicalize(receipt), signature);
    return { ok: recovered.toLowerCase() === grader.toLowerCase(), recovered };
  } catch {
    return { ok: false, recovered: "0xInvalid" };
  }
}

export const short = (a?: string | null) => (!a ? "—" : a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export interface ModelCard { id: string; tier: string; open_source: boolean; price_per_call: number; context: number }
export interface Benchmark {
  name: string; version: string; models: ModelCard[];
  scoring_params: { cost_penalty_lambda: number; openness_bonus_beta: number; confidence_threshold: number };
  n_prompts: number; eval_set_hash: string; catalog_hash: string;
}
export interface LeaderRow { rank: number; participant: string; score: number; submission_id: string; policy_hash: string }
export interface SubmitResult {
  submission_id: string; score: number; mean_quality: number; mean_cost: number; oss_rate: number; invalid: number;
  receipt: unknown; signature: string; grader_address: string; error?: string;
}

// Starter policy shown in the editor. Free-first, escalate the hard ones.
export const DEFAULT_POLICY = `import type { PromptView, ModelCard, Decision } from "./types";

// Goal: high quality per dollar, lean on free/open models.
//   score = mean_quality - λ·mean_cost + β·oss_rate
export function decide(prompt: PromptView, models: ModelCard[]): Decision {
  const freeOpen = models.filter(m => m.open_source && m.price_per_call === 0).map(m => m.id);
  const strongest = models.find(m => !m.open_source)?.id ?? models[models.length - 1].id;

  // Hard prompt: start free, escalate to a strong model only if confidence is low.
  if (prompt.signals.complexity_band === "high" || prompt.signals.has_code) {
    return { looper: "confidence", candidates: [...freeOpen, strongest] };
  }
  // Easy/medium: a free OSS model, single shot. Zero cost, full openness bonus.
  return { looper: "single", candidates: [freeOpen[0] ?? models[0].id] };
}
`;

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

// Starter policy shown in the editor. Cheapest-first, escalate the hard ones.
export const DEFAULT_POLICY = `import type { PromptView, ModelCard, Decision } from "./types";

// Every model is open + free to call — the game is quality vs compute.
//   score = mean_quality - λ·mean_cost   (price_per_call = compute-cost proxy)
export function decide(prompt: PromptView, models: ModelCard[]): Decision {
  // cheapest (smallest) -> most expensive (largest) compute
  const ladder = [...models].sort((a, b) => a.price_per_call - b.price_per_call).map(m => m.id);

  // Hard prompt: start cheap and escalate up the ladder only if confidence is low.
  // You pay for a bigger call only when it actually escalates.
  if (prompt.signals.complexity_band === "high" || prompt.signals.has_code) {
    return { looper: "confidence", candidates: ladder };
  }
  // Easy/medium: smallest model, single shot. Lowest compute.
  return { looper: "single", candidates: [ladder[0]] };
}
`;

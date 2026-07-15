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
  n_prompts: number; n_stages?: number; eval_set_hash: string; catalog_hash: string;
}
export interface LeaderRow { rank: number; participant: string; score: number; submission_id: string; policy_hash: string }
export interface SubmitResult {
  submission_id: string; score: number; mean_quality: number; mean_cost: number; oss_rate: number; invalid: number;
  receipt: unknown; signature: string; grader_address: string; error?: string;
}

// Starter policy shown in the editor. Tasks are multi-stage — route each stage.
export const DEFAULT_POLICY = `import type { PromptView, ModelCard, Decision } from "./types";

// Tasks are multi-stage (plan → implement → test → review). decide() runs once
// per stage; route on prompt.stage.kind. Every model is open + free, so it's
// quality vs compute (price_per_call = compute-cost proxy):
//   score = mean_quality - λ·mean_cost
export function decide(prompt: PromptView, models: ModelCard[]): Decision {
  const ladder = [...models].sort((a, b) => a.price_per_call - b.price_per_call).map(m => m.id);
  const cheapest = ladder[0];
  const strongest = ladder[ladder.length - 1];
  const coder = models.find(m => m.tier === "code")?.id;
  const kind = prompt.stage?.kind;

  // Coding stages → a code specialist, escalate to the strongest if unsure.
  if (kind === "implement" || kind === "debug" || prompt.signals.has_code) {
    return { looper: "confidence", candidates: [coder ?? cheapest, strongest] };
  }
  // Reasoning stages (plan / review / test) → a mid model, single shot.
  if (kind === "plan" || kind === "review" || kind === "test") {
    return { looper: "single", candidates: [ladder[Math.min(2, ladder.length - 1)]] };
  }
  // Anything else → cheapest.
  return { looper: "single", candidates: [cheapest] };
}
`;

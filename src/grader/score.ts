// Scoring — the source of truth the grader signs over. Mirrors arena/run.mjs
// (the participant-facing local scorer) exactly; keep the two in sync.

export interface Outcome { quality: number; confidence: number }
export interface HiddenPrompt {
  id: string;
  text: string;
  signals: Record<string, unknown>;
  outcomes: Record<string, Outcome>;
}
export interface ModelCard {
  id: string;
  tier: string;
  open_source: boolean;
  price_per_call: number;
  context: number;
}
export interface Params {
  cost_penalty_lambda: number;
  openness_bonus_beta: number;
  confidence_threshold: number;
}
export interface Decision { looper: string; candidates: string[] }
export interface PromptRow { id: string; chosen_model: string | null; quality: number; cost: number }

type Sim = { chosen: string; called: string[]; qualityOverride?: number } | { invalid: true };

function simulate(dec: Decision | null, outcomes: Record<string, Outcome>, thresh: number, byId: Record<string, ModelCard>): Sim {
  const cand = (dec?.candidates ?? []).filter((id) => byId[id] && outcomes[id]);
  if (!cand.length) return { invalid: true };
  const q = (id: string) => outcomes[id].quality;
  const conf = (id: string) => outcomes[id].confidence;

  switch (dec!.looper) {
    case "single":
      return { chosen: cand[0], called: [cand[0]] };
    case "confidence": {
      const called: string[] = [];
      for (const id of cand) { called.push(id); if (conf(id) >= thresh) return { chosen: id, called }; }
      return { chosen: called[called.length - 1], called };
    }
    case "ratings": {
      const chosen = [...cand].sort((a, b) => q(b) - q(a))[0];
      return { chosen, called: cand };
    }
    case "remom": {
      const agg = cand[0];
      const best = Math.max(...cand.map(q));
      return { chosen: agg, called: [...cand, agg], qualityOverride: Math.min(1, best + 0.03) };
    }
    default:
      return { invalid: true };
  }
}

export interface Scored {
  rows: PromptRow[];
  mean_quality: number;
  mean_cost: number;
  oss_rate: number;
  score: number;
  invalid: number;
}

/** Score a set of routing decisions against the hidden outcomes. */
export function score(
  decisions: Record<string, Decision | null>,
  prompts: HiddenPrompt[],
  models: ModelCard[],
  params: Params,
): Scored {
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  const rows: PromptRow[] = [];
  let sumQ = 0, sumC = 0, oss = 0, invalid = 0;

  for (const p of prompts) {
    const sim = simulate(decisions[p.id] ?? null, p.outcomes, params.confidence_threshold, byId);
    if ("invalid" in sim) {
      invalid++;
      rows.push({ id: p.id, chosen_model: null, quality: 0, cost: 0 });
      continue;
    }
    const quality = sim.qualityOverride ?? p.outcomes[sim.chosen].quality;
    const cost = sim.called.reduce((s, id) => s + byId[id].price_per_call, 0);
    if (byId[sim.chosen].open_source) oss++;
    sumQ += quality; sumC += cost;
    rows.push({ id: p.id, chosen_model: sim.chosen, quality, cost });
  }

  const n = prompts.length;
  const mean_quality = sumQ / n, mean_cost = sumC / n, oss_rate = oss / n;
  const s = mean_quality - params.cost_penalty_lambda * mean_cost + params.openness_bonus_beta * oss_rate;
  return { rows, mean_quality, mean_cost, oss_rate, score: s, invalid };
}

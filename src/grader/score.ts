// Scoring — the source of truth the grader signs over. Runs each policy's route
// LIVE: the chosen models actually answer the hidden task via OpenRouter, and an
// LLM judge grades the output. Non-deterministic by nature — the receipt is
// trustworthy because it's produced inside an attested enclave, not because you
// can re-run it (see docs/arena-routing.md).
//
// The local dev scorer (arena/score.mjs) is a precomputed-outcome PROXY of this:
// same looper route-selection, quality/confidence faked from a table so you can
// iterate offline without keys or spend. It predicts, it doesn't reproduce.
import type { Infer, ChatMessage } from "./infer.js";

export interface HiddenTask {
  id: string;
  text: string;                         // the task prompt the routed models must answer
  signals: Record<string, unknown>;     // precomputed, what the policy sees
  rubric: string;                       // grading criteria (hidden from the policy)
}
export interface ModelCard {
  id: string;
  tier: string;
  open_source: boolean;
  price_per_call: number;
  context: number;
  openrouter: string;                   // OpenRouter model slug for live calls
}
export interface Params {
  cost_penalty_lambda: number;
  openness_bonus_beta: number;
  confidence_threshold: number;
}
export interface Decision { looper: string; candidates: string[] }
export interface PromptRow { id: string; chosen_model: string | null; quality: number; cost: number }

type Route = { chosen: string; called: string[]; quality: number } | { invalid: true };

/** Execute one policy decision against a task: call the routed model(s) for real,
 *  grade the winning output. Quality is 0 when the chosen model errored. */
async function runRoute(dec: Decision | null, task: HiddenTask, thresh: number, byId: Record<string, ModelCard>, infer: Infer): Promise<Route> {
  const cand = (dec?.candidates ?? []).filter((id) => byId[id]);
  if (!cand.length) return { invalid: true };
  const msgs: ChatMessage[] = [{ role: "user", content: task.text }];
  const grade = (out: CallOut) => (out.error ? 0 : infer.grade(task, out.content));

  switch (dec!.looper) {
    case "single": {
      const r = await infer.call(cand[0], msgs);
      return { chosen: cand[0], called: [cand[0]], quality: await grade(r) };
    }
    case "confidence": {
      const called: string[] = [];
      let last: CallOut = { content: "", confidence: null, error: "empty" };
      let lastId = cand[0];
      for (const id of cand) {
        last = await infer.call(id, msgs); called.push(id); lastId = id;
        if (!last.error && (last.confidence ?? 0) >= thresh) break;
      }
      return { chosen: lastId, called, quality: await grade(last) };
    }
    case "ratings": {
      const outs = await Promise.all(cand.map((id) => infer.call(id, msgs)));
      const graded = await Promise.all(outs.map(grade));
      let best = 0;
      for (let i = 1; i < graded.length; i++) if (graded[i] > graded[best]) best = i;
      return { chosen: cand[best], called: cand, quality: graded[best] };
    }
    case "remom": {
      const props = await Promise.all(cand.map((id) => infer.call(id, msgs)));
      const good = props.filter((p) => !p.error).map((p, i) => `Answer ${i + 1}:\n${p.content}`).join("\n\n");
      const agg = cand[0];
      const synth = await infer.call(agg, [{ role: "user", content: `${task.text}\n\nSynthesize the best single answer from these candidates:\n\n${good}` }]);
      return { chosen: agg, called: [...cand, agg], quality: await grade(synth) };
    }
    default:
      return { invalid: true };
  }
}

type CallOut = Awaited<ReturnType<Infer["call"]>>;

export interface Scored {
  rows: PromptRow[];
  mean_quality: number;
  mean_cost: number;
  oss_rate: number;
  score: number;
  invalid: number;
}

/** Score a set of routing decisions by running each route live and grading it. */
export async function score(
  decisions: Record<string, Decision | null>,
  tasks: HiddenTask[],
  models: ModelCard[],
  params: Params,
  infer: Infer,
): Promise<Scored> {
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  const rows: PromptRow[] = [];
  let sumQ = 0, sumC = 0, oss = 0, invalid = 0;

  for (const t of tasks) {
    const r = await runRoute(decisions[t.id] ?? null, t, params.confidence_threshold, byId, infer);
    if ("invalid" in r) {
      invalid++;
      rows.push({ id: t.id, chosen_model: null, quality: 0, cost: 0 });
      continue;
    }
    const cost = r.called.reduce((s, id) => s + byId[id].price_per_call, 0);
    if (byId[r.chosen].open_source) oss++;
    sumQ += r.quality; sumC += cost;
    rows.push({ id: t.id, chosen_model: r.chosen, quality: r.quality, cost });
  }

  const n = tasks.length;
  const mean_quality = sumQ / n, mean_cost = sumC / n, oss_rate = oss / n;
  const s = mean_quality - params.cost_penalty_lambda * mean_cost + params.openness_bonus_beta * oss_rate;
  return { rows, mean_quality, mean_cost, oss_rate, score: s, invalid };
}

// Scoring — the source of truth the grader signs over. Runs each policy's route
// LIVE across a MULTI-STAGE task: for every stage the policy picks a model, the
// harness runs it on the stage prompt WITH the prior stages' output as context,
// chains them, and an LLM judge grades the final transcript. Non-deterministic
// by nature — trustworthy because it runs in an attested enclave, not because
// you can re-run it (see docs).
//
// Routing per stage depends only on the stage's fixed metadata (kind/prompt/
// signals), so decide() stays pure and is precomputed for every stage upfront;
// only inference is chained. The local dev scorer (arena/score.mjs) is a
// precomputed-outcome PROXY of this.
import type { Infer, ChatMessage } from "./infer.js";

export interface Stage {
  id: string;
  kind: string;                         // plan | implement | test | review | debug | ...
  prompt: string;                       // the stage instruction
  signals: Record<string, unknown>;     // precomputed, what the policy sees for this stage
}
export interface HiddenTask {
  id: string;
  title: string;                        // short task name (context, not the answer)
  stages: Stage[];
  rubric: string;                       // grades the FINAL solution (hidden from the policy)
}
export interface ModelCard {
  id: string;
  tier: string;
  open_source: boolean;
  price_per_call: number;               // compute-cost proxy
  context: number;
  openrouter: string;
}
export interface Params {
  cost_penalty_lambda: number;
  openness_bonus_beta: number;
  confidence_threshold: number;
}
export interface Decision { looper: string; candidates: string[] }
export interface PromptRow { id: string; stages: number; chosen_models: string[]; quality: number; cost: number }

type CallOut = Awaited<ReturnType<Infer["call"]>>;
type StageRun = { chosen: string; called: string[]; output: string } | { invalid: true };

/** Run one stage's looper → produce the chosen output text (+ models called).
 *  `criterion` is what ratings grades candidates against (the stage's own goal). */
async function runStage(dec: Decision | null, messages: ChatMessage[], criterion: string, byId: Record<string, ModelCard>, thresh: number, infer: Infer): Promise<StageRun> {
  const cand = (dec?.candidates ?? []).filter((id) => byId[id]);
  if (!cand.length) return { invalid: true };

  switch (dec!.looper) {
    case "single": {
      const r = await infer.call(cand[0], messages);
      return { chosen: cand[0], called: [cand[0]], output: r.content };
    }
    case "confidence": {
      const called: string[] = [];
      let last: CallOut = { content: "", confidence: null, error: "empty" };
      let lastId = cand[0];
      for (const id of cand) {
        last = await infer.call(id, messages); called.push(id); lastId = id;
        if (!last.error && (last.confidence ?? 0) >= thresh) break;
      }
      return { chosen: lastId, called, output: last.content };
    }
    case "ratings": {
      const outs = await Promise.all(cand.map((id) => infer.call(id, messages)));
      const graded = await Promise.all(outs.map((o) => (o.error ? Promise.resolve(0) : infer.grade({ text: "", rubric: criterion }, o.content))));
      let best = 0;
      for (let i = 1; i < graded.length; i++) if (graded[i] > graded[best]) best = i;
      return { chosen: cand[best], called: cand, output: outs[best].content };
    }
    case "remom": {
      const props = await Promise.all(cand.map((id) => infer.call(id, messages)));
      const good = props.filter((p) => !p.error).map((p, i) => `Candidate ${i + 1}:\n${p.content}`).join("\n\n");
      const agg = cand[0];
      const synth = await infer.call(agg, [...messages, { role: "user", content: `Synthesize the single best result from these candidates:\n\n${good}` }]);
      return { chosen: agg, called: [...cand, agg], output: synth.content };
    }
    default:
      return { invalid: true };
  }
}

function stagePrompt(task: HiddenTask, stage: Stage, transcript: string): string {
  const ctx = transcript ? `\n\nWork completed so far:${transcript}\n` : "";
  return `You are working through a multi-stage engineering task: "${task.title}".${ctx}\n---\nCurrent stage — ${stage.kind}:\n${stage.prompt}`;
}

export interface Scored {
  rows: PromptRow[];
  mean_quality: number;
  mean_cost: number;
  oss_rate: number;
  score: number;
  invalid: number;
}

/** Score routing decisions by running each task's stages live and grading the
 *  final transcript. `decisions` is keyed by `${taskId}::${stageId}`. */
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
    let transcript = "";
    const called: string[] = [];
    const chosen: string[] = [];
    let bad = false;

    for (let i = 0; i < t.stages.length; i++) {
      const st = t.stages[i];
      const dec = decisions[`${t.id}::${st.id}`] ?? null;
      const msgs: ChatMessage[] = [{ role: "user", content: stagePrompt(t, st, transcript) }];
      const r = await runStage(dec, msgs, st.prompt, byId, params.confidence_threshold, infer);
      if ("invalid" in r) { bad = true; break; }
      called.push(...r.called);
      chosen.push(r.chosen);
      transcript += `\n\n## Stage ${i + 1} — ${st.kind}\n${r.output}`;
    }

    if (bad) {
      invalid++;
      rows.push({ id: t.id, stages: t.stages.length, chosen_models: [], quality: 0, cost: 0 });
      continue;
    }
    const quality = await infer.grade({ text: t.title, rubric: t.rubric }, transcript.trim());
    const cost = called.reduce((s, id) => s + byId[id].price_per_call, 0);
    if (chosen.length && chosen.every((id) => byId[id]?.open_source)) oss++;
    sumQ += quality; sumC += cost;
    rows.push({ id: t.id, stages: t.stages.length, chosen_models: chosen, quality, cost });
  }

  const n = tasks.length;
  const mean_quality = sumQ / n, mean_cost = sumC / n, oss_rate = oss / n;
  const s = mean_quality - params.cost_penalty_lambda * mean_cost + params.openness_bonus_beta * oss_rate;
  return { rows, mean_quality, mean_cost, oss_rate, score: s, invalid };
}

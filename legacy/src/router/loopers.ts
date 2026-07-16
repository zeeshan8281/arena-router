import { config } from "../config.js";
import { callWorker, type WorkerCall } from "./workers.js";
import type { AttestationRecord } from "../attestation.js";
import type { ChatBody } from "./signals.js";

export interface LooperResult {
  chosen_model: string;
  content: string;
  error: boolean;                     // final chosen route was not a verified success
  attestations: AttestationRecord[];  // every worker call made, in order
}

export async function runLooper(
  looper: string,
  candidates: string[],
  body: ChatBody,
): Promise<LooperResult> {
  switch (looper) {
    case "single":
      return single(candidates, body);
    case "confidence":
      return confidence(candidates, body);
    case "ratings":
      return ratings(candidates, body);
    case "remom":
      return remom(candidates, body);
    default:
      throw new Error(`unknown looper "${looper}"`);
  }
}

/** Route to the first candidate. One attested call. */
async function single(candidates: string[], body: ChatBody): Promise<LooperResult> {
  const c = await callWorker(candidates[0], body);
  return { chosen_model: candidates[0], content: c.content, error: !c.ok, attestations: [c.record] };
}

/**
 * Call the cheapest candidate; if its confidence (geometric-mean token
 * probability from logprobs) is below threshold, escalate to the next.
 * Records every attempt.
 */
async function confidence(candidates: string[], body: ChatBody): Promise<LooperResult> {
  const threshold = config().params.confidence_threshold;
  const attestations: AttestationRecord[] = [];
  let last: WorkerCall | null = null;

  for (const model of candidates) {
    const c = await callWorker(model, body);
    attestations.push(c.record);
    last = c;
    if (c.ok && toConfidence(c.avg_logprob) >= threshold) {
      return { chosen_model: model, content: c.content, error: false, attestations };
    }
  }
  const l = last!;
  return {
    chosen_model: candidates[candidates.length - 1],
    content: l.content,
    error: !l.ok,
    attestations,
  };
}

/**
 * Fan out to every candidate in parallel, then pick the highest-confidence
 * verified response. Every worker's signed attestation is retained.
 */
async function ratings(candidates: string[], body: ChatBody): Promise<LooperResult> {
  const calls = await Promise.all(candidates.map((m) => callWorker(m, body)));
  const attestations = calls.map((c) => c.record);

  const ranked = calls
    .map((c, i) => ({ c, model: candidates[i], score: c.ok ? toConfidence(c.avg_logprob) : -1 }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  return {
    chosen_model: best.model,
    content: best.c.content,
    error: !best.c.ok,
    attestations,
  };
}

/**
 * Repeated Mixture-of-Models (Mixture-of-Agents): each round, all candidates
 * propose in parallel, then an aggregator candidate synthesizes the proposals;
 * the synthesis feeds the next round. Every worker call is attested.
 */
async function remom(candidates: string[], body: ChatBody): Promise<LooperResult> {
  const rounds = config().params.remom_rounds;
  const aggregator = candidates[0];
  const attestations: AttestationRecord[] = [];
  const original = (body.messages ?? []).map((m) => m.content).join("\n");

  let synthesis = "";
  let lastCall: WorkerCall | null = null;

  for (let round = 0; round < rounds; round++) {
    const seed = synthesis
      ? `${original}\n\nPrior synthesized answer to improve on:\n${synthesis}`
      : original;

    // Propose: every candidate answers the (seeded) prompt in parallel.
    const proposals = await Promise.all(
      candidates.map((m) => callWorker(m, msg(seed))),
    );
    proposals.forEach((p) => attestations.push(p.record));

    const good = proposals.filter((p) => p.ok).map((p) => p.content);
    const aggPrompt =
      `Original request:\n${original}\n\n` +
      `Candidate answers:\n${good.map((g, i) => `[${i + 1}] ${g}`).join("\n\n")}\n\n` +
      `Synthesize a single best answer.`;

    const agg = await callWorker(aggregator, msg(aggPrompt));
    attestations.push(agg.record);
    lastCall = agg;
    synthesis = agg.ok ? agg.content : synthesis;
  }

  return {
    chosen_model: aggregator,
    content: synthesis,
    error: !lastCall?.ok,
    attestations,
  };
}

// --- helpers ---

// Geometric-mean per-token probability from a mean log-probability.
function toConfidence(avgLogprob: number | null): number {
  if (avgLogprob === null) return 0; // no signal → do not clear the bar
  return Math.exp(avgLogprob);
}

function msg(content: string): ChatBody {
  return { messages: [{ role: "user", content }] };
}

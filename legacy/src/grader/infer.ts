// Live inference for the hidden grader. Runs INSIDE the enclave (the only side
// that holds OPENROUTER_API_KEY — participant policies are sealed and can't call
// out, so this is the trusted boundary that actually spends money on tokens).
//
// Two operations the scorer needs:
//   call(modelId, messages) → the routed model's real answer (+ a confidence)
//   grade(task, output)     → an LLM judge's quality score in [0,1]
import type { ModelCard } from "./score.js";

export interface CallResult { content: string; confidence: number | null; error?: string }
export interface Infer {
  call(modelId: string, messages: ChatMessage[]): Promise<CallResult>;
  grade(task: { text: string; rubric: string }, output: string): Promise<number>;
}
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

const OR_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wire up a live OpenRouter-backed Infer. `graderModel` judges every output. */
export function makeOpenRouter(apiKey: string, graderModel: string, byId: Record<string, ModelCard>): Infer {
  async function chat(model: string, messages: ChatMessage[], maxTokens: number, logprobs: boolean): Promise<any> {
    // Free OpenRouter models are heavily rate-limited (429). Back off and retry
    // so a throttle doesn't turn into a quality-0 that punishes the policy for
    // infra, not routing. ponytail: fixed 5 attempts / capped backoff — plenty
    // for per-minute limits; if daily caps bite, move that model to a paid slug.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(OR_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
            "x-title": "autorouter-arena",
          },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, ...(logprobs ? { logprobs: true } : {}) }),
          signal: ctrl.signal,
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`openrouter ${res.status}`);
        if (!res.ok) throw new Error(`openrouter ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < 4) await sleep(Math.min(8000, 500 * 2 ** attempt)); // 0.5s,1s,2s,4s
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  return {
    async call(modelId, messages) {
      const model = byId[modelId]?.openrouter;
      if (!model) return { content: "", confidence: null, error: `no openrouter slug for ${modelId}` };
      try {
        const data = await chat(model, messages, 1024, true);
        const content = data?.choices?.[0]?.message?.content ?? "";
        return { content, confidence: logprobConfidence(data) };
      } catch (e) {
        return { content: "", confidence: null, error: (e as Error).message };
      }
    },

    async grade(task, output) {
      const messages: ChatMessage[] = [{
        role: "user",
        content:
          `You are grading a candidate answer. Score how well it satisfies the rubric.\n\n` +
          `TASK:\n${task.text}\n\nRUBRIC:\n${task.rubric}\n\nCANDIDATE ANSWER:\n${output}\n\n` +
          `Reply with ONLY a JSON object: {"score": <number between 0 and 1>}.`,
      }];
      try {
        const data = await chat(graderModel, messages, 200, false);
        const text = data?.choices?.[0]?.message?.content ?? "";
        const m = text.match(/\{[^}]*"score"[^}]*\}/s);
        const score = m ? Number(JSON.parse(m[0]).score) : NaN;
        return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
      } catch {
        return 0; // a grader that can't score doesn't get to hand out credit
      }
    },
  };
}

/** Geometric-mean per-token probability from OpenRouter logprobs; null if absent.
 *  Mirrors the router's toConfidence (exp of mean logprob). null → treated as 0. */
function logprobConfidence(data: any): number | null {
  const lp = data?.choices?.[0]?.logprobs?.content;
  if (!Array.isArray(lp) || !lp.length) return null;
  const avg = lp.reduce((s: number, t: any) => s + (t?.logprob ?? 0), 0) / lp.length;
  return Math.exp(avg);
}

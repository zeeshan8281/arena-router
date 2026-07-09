import { workerConfig } from "./config.js";
import type { ChatBody } from "../router/signals.js";

export interface Inference {
  content: string;
  avg_logprob: number | null; // mean token log-probability, when the backend exposes it
}

/** Run the model this worker hosts. In a GPU enclave this is a local model; the
 *  openai backend proxies to an OpenAI-compatible API but the worker still signs. */
export async function infer(modelId: string, body: ChatBody): Promise<Inference> {
  return workerConfig().backend === "echo" ? echo(modelId, body) : openai(modelId, body);
}

// Deterministic backend for offline dev / CI: no network, stable output + a
// stable synthetic confidence so routing loopers are testable.
function echo(modelId: string, body: ChatBody): Inference {
  const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  const content = `[echo:${modelId}] ${lastUser?.content ?? ""}`.trim();
  // "mini" models look less confident so escalation paths are exercised.
  const avg_logprob = /mini/i.test(modelId) ? -1.0 : -0.05;
  return { content, avg_logprob };
}

async function openai(modelId: string, body: ChatBody): Promise<Inference> {
  const { apiBase, apiKey } = workerConfig();
  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelId,
      messages: body.messages ?? [],
      max_tokens: body.max_tokens ?? 512,
      logprobs: true,
    }),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; logprobs?: { content?: { logprob: number }[] } }[];
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  const lps = choice?.logprobs?.content ?? [];
  const avg_logprob = lps.length ? lps.reduce((s, t) => s + t.logprob, 0) / lps.length : null;
  return { content, avg_logprob };
}

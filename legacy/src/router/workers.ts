import { verifyMessage } from "ethers";
import { canonicalize, hash } from "../crypto.js";
import { config } from "../config.js";
import type { AttestationRecord, WorkerResponse } from "../attestation.js";
import type { ChatBody } from "./signals.js";

export interface WorkerCall {
  ok: boolean;                 // reachable, signature + hashes + model_id all check out
  content: string;
  avg_logprob: number | null;  // advisory routing signal (confidence / ratings)
  record: AttestationRecord;   // what gets folded into the routing receipt
}

const TIMEOUT_MS = 30_000;

/**
 * Call the attested worker that serves `modelId`, then INDEPENDENTLY verify
 * its signed attestation before trusting the result:
 *   - signature recovers to the claimed worker_address
 *   - the signed bytes are exactly canonicalize(attestation) (no bait-and-switch)
 *   - response_hash matches the content actually returned
 *   - the worker attests the model_id we asked for
 * A failure at any step yields ok:false with an unverified record — the
 * conductor still records the attempt (a failed route is auditable).
 */
export async function callWorker(modelId: string, body: ChatBody): Promise<WorkerCall> {
  const url = config().workers[modelId];
  if (!url) {
    return { ok: false, content: "", avg_logprob: null, record: unverified(modelId) };
  }

  const payload = JSON.stringify({
    model: modelId,
    messages: body.messages ?? [],
    max_tokens: body.max_tokens ?? 512,
  });

  let data: WorkerResponse;
  try {
    data = await postJson(`${url}/infer`, payload);
  } catch {
    return { ok: false, content: "", avg_logprob: null, record: unverified(modelId) };
  }

  const a = data.attestation;
  const verified =
    canonicalize(a) === data.canonical &&
    safeRecover(data.canonical, data.signature) === a.worker_address.toLowerCase() &&
    hash(data.content) === a.response_hash &&
    a.model_id === modelId;

  const record: AttestationRecord = {
    model_id: modelId,
    worker_address: verified ? a.worker_address : null,
    response_hash: verified ? a.response_hash : null,
    image_digest: a.image_digest,
    canonical: verified ? data.canonical : null,
    signature: verified ? data.signature : null,
    verified,
  };

  return { ok: verified, content: verified ? data.content : "", avg_logprob: data.metrics?.avg_logprob ?? null, record };
}

function unverified(modelId: string): AttestationRecord {
  return { model_id: modelId, worker_address: null, response_hash: null, canonical: null, signature: null, verified: false };
}

function safeRecover(canonical: string, signature: string): string {
  try {
    return verifyMessage(canonical, signature).toLowerCase();
  } catch {
    return "";
  }
}

async function postJson(url: string, payload: string): Promise<WorkerResponse> {
  // one retry
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`worker ${res.status}`);
      return (await res.json()) as WorkerResponse;
    } catch (e) {
      if (attempt === 1) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("unreachable");
}

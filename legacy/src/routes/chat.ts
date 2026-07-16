import { Router, type Request } from "express";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { extractSignals, type ChatBody } from "../router/signals.js";
import { decide } from "../router/policy.js";
import { runLooper } from "../router/loopers.js";
import { buildAndStore, hash, type RoutingReceipt } from "../receipt.js";

export const chat = Router();

// POST /v1/route — the main endpoint.
chat.post("/v1/route", async (req: Request & { rawBody?: string }, res) => {
  const body = req.body as ChatBody;
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: "messages[] is required" });
  }

  const cfg = config();
  const rawBody = req.rawBody ?? JSON.stringify(body);

  const signals = extractSignals(body);
  const { looper, candidates } = decide(signals);
  const looperResult = await runLooper(looper, candidates, body);

  const receipt: RoutingReceipt = {
    version: "1",
    task_id: randomUUID(),
    timestamp: Date.now(),
    input_hash: hash(rawBody),
    signals,
    policy_hash: cfg.policyHash,
    looper: looper as RoutingReceipt["looper"],
    candidates_considered: candidates,
    chosen_model: looperResult.chosen_model,
    response_hash: hash(looperResult.content),
    worker_attestations: looperResult.attestations,
    ...(looperResult.error ? { error: true } : {}),
    ...(cfg.imageDigest ? { image_digest: cfg.imageDigest } : {}),
  };

  const bundle = await buildAndStore(receipt);

  res.json({
    task_id: receipt.task_id,
    model: receipt.chosen_model,
    content: looperResult.content,
    receipt,
    signature: bundle.signature,
    signer_address: bundle.signer_address,
    verify: `GET /trace/${receipt.task_id}`,
  });
});

import { Router } from "express";
import { config } from "../config.js";

export const recipe = Router();

// GET /recipe — the active routing policy from _PUBLIC env, human-readable
// alongside the policy_hash that ties every receipt to it. policy_hash commits
// to bands + params, so this is fully checkable against any receipt.
recipe.get("/recipe", (_req, res) => {
  const cfg = config();
  res.json({
    router_version: cfg.routerVersion,
    policy_hash: cfg.policyHash,
    recipe: cfg.recipe,
    params: cfg.params,
    workers: cfg.workers, // model_id -> attested worker URL (each verifiable via its /pubkey)
    notes: {
      loopers: {
        single: "route to the first candidate",
        confidence:
          "call cheapest candidate; escalate to the next when its confidence (geometric-mean token probability from logprobs) is below params.confidence_threshold",
        ratings: "fan out to every candidate in parallel; pick the highest-confidence verified response",
        remom: "repeated Mixture-of-Agents: each round all candidates propose, an aggregator synthesizes; repeats params.remom_rounds times",
      },
      signals: "token_estimate = chars/4; detected_lang by script heuristic; complexity_band rule-based. All deterministic.",
      attestation: "every model call goes to an attested worker that signs {model_id, input_hash, response_hash} with its own enclave key; those signatures are folded into worker_attestations[].",
    },
  });
});

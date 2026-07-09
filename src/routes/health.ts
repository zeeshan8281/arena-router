import { Router } from "express";
import { config } from "../config.js";
import { signerAddress } from "../signer.js";

export const health = Router();

// GET /health
health.get("/health", (_req, res) => {
  res.json({ ok: true, signer: signerAddress(), policy_hash: config().policyHash });
});

// GET /pubkey — signer address, to match against a Derived Address on the dashboard.
health.get("/pubkey", (_req, res) => {
  res.json({ address: signerAddress() });
});

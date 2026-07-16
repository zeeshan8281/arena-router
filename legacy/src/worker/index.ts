import express from "express";
import { canonicalize, hash, walletFromPhrase } from "../crypto.js";
import { loadWorkerConfig, workerConfig } from "./config.js";
import { infer } from "./backend.js";
import type { ChatBody } from "../router/signals.js";
import type { WorkerAttestation, WorkerResponse } from "../attestation.js";
import { cors } from "../cors.js";

const cfg = loadWorkerConfig();
const wallet = walletFromPhrase(process.env.MNEMONIC!);

const app = express();
app.use(cors);
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);

// POST /infer — run the model and return a SIGNED attestation of the result.
app.post("/infer", async (req: express.Request & { rawBody?: string }, res) => {
  const body = req.body as ChatBody & { model?: string };
  const modelId = body.model;
  if (!modelId || !cfg.models.includes(modelId)) {
    return res.status(400).json({ error: `this worker does not serve model "${modelId ?? ""}"` });
  }

  let content: string;
  let avg_logprob: number | null;
  try {
    ({ content, avg_logprob } = await infer(modelId, body));
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message });
  }

  const attestation: WorkerAttestation = {
    version: "1",
    model_id: modelId,
    input_hash: hash(req.rawBody ?? JSON.stringify(body)),
    response_hash: hash(content),
    timestamp: Date.now(),
    worker_address: wallet.address,
    ...(cfg.imageDigest ? { image_digest: cfg.imageDigest } : {}),
  };
  const canonical = canonicalize(attestation);
  const signature = await wallet.signMessage(canonical);

  const out: WorkerResponse = { content, attestation, canonical, signature, metrics: { avg_logprob } };
  res.json(out);
});

app.get("/pubkey", (_req, res) => res.json({ address: wallet.address }));
app.get("/health", (_req, res) => res.json({ ok: true, models: cfg.models, address: wallet.address }));

const port = Number(process.env.PORT) || 8090;
app.listen(port, "0.0.0.0", () => {
  console.log(
    `attested-worker listening on :${port} | address=${wallet.address} | models=${cfg.models.join(",")} | backend=${cfg.backend}`,
  );
});

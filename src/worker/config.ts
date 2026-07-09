export interface WorkerConfig {
  models: string[];              // model ids this worker is allowed to serve
  backend: "echo" | "openai";
  apiBase?: string;             // openai backend
  apiKey?: string;              // openai backend (sealed)
  imageDigest?: string;
}

let cfg: WorkerConfig;

export function loadWorkerConfig(): WorkerConfig {
  if (!process.env.MNEMONIC) {
    throw new Error("MNEMONIC missing — refusing to boot outside a provisioned enclave");
  }
  // Same rule as the conductor: a sealed secret must never carry a _PUBLIC suffix.
  if (process.env.MODEL_API_KEY_PUBLIC) {
    throw new Error("MODEL_API_KEY_PUBLIC is set — a sealed secret must never carry a _PUBLIC suffix");
  }

  const models = req("MODEL_IDS_PUBLIC").split(",").map((s) => s.trim()).filter(Boolean);
  if (!models.length) throw new Error("MODEL_IDS_PUBLIC must list at least one model id");

  const backend = (process.env.WORKER_BACKEND_PUBLIC ?? "echo") as WorkerConfig["backend"];
  if (backend !== "echo" && backend !== "openai") {
    throw new Error(`WORKER_BACKEND_PUBLIC must be "echo" or "openai"`);
  }

  cfg = {
    models,
    backend,
    imageDigest: process.env.IMAGE_DIGEST_PUBLIC || undefined,
  };

  if (backend === "openai") {
    cfg.apiBase = req("MODEL_API_BASE_PUBLIC").replace(/\/+$/, "");
    cfg.apiKey = process.env.MODEL_API_KEY;
    if (!cfg.apiKey) throw new Error("MODEL_API_KEY required for the openai backend");
  }
  return cfg;
}

export function workerConfig(): WorkerConfig {
  if (!cfg) throw new Error("worker config not loaded");
  return cfg;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

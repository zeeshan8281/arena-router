import { canonicalize, hash } from "./crypto.js";

export interface Band {
  looper: "single" | "confidence" | "ratings" | "remom";
  models: string[];
}

export interface Params {
  confidence_threshold: number; // confidence looper: escalate below this (0..1)
  remom_rounds: number;         // remom: number of propose→aggregate rounds
}

export interface Recipe {
  bands: Record<"low" | "med" | "high", Band>;
  params?: Partial<Params>;
}

export interface Config {
  workers: Record<string, string>; // model_id -> worker base URL
  recipe: Recipe;
  params: Params;
  policyCanonical: string;
  policyHash: string;
  routerVersion: string;
  imageDigest?: string;
}

const DEFAULT_PARAMS: Params = { confidence_threshold: 0.5, remom_rounds: 2 };

let cfg: Config;

export function loadConfig(): Config {
  if (process.env.MNEMONIC === undefined) {
    throw new Error("MNEMONIC missing — refusing to boot outside a provisioned enclave");
  }

  const recipe = parseRecipe(req("ROUTING_RECIPE_PUBLIC"));
  const params: Params = { ...DEFAULT_PARAMS, ...(recipe.params ?? {}) };
  const workers = parseWorkers(req("WORKERS_PUBLIC"));

  assertWorkersCoverRecipe(recipe, workers);

  // policy_hash commits to everything that affects the decision: bands + params.
  const policyCanonical = canonicalize({ bands: recipe.bands, params });

  cfg = {
    workers,
    recipe,
    params,
    policyCanonical,
    policyHash: hash(policyCanonical),
    routerVersion: process.env.ROUTER_VERSION_PUBLIC ?? "1.0.0",
    imageDigest: process.env.IMAGE_DIGEST_PUBLIC || undefined,
  };
  return cfg;
}

export function config(): Config {
  if (!cfg) throw new Error("config not loaded — call loadConfig() first");
  return cfg;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

// Env pipelines mangle raw JSON (quotes/braces/colons), so accept base64 too.
// Still public: anyone can base64-decode a _PUBLIC var and check it.
function decodeJson<T>(raw: string, name: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as T;
    } catch {
      throw new Error(`${name} is not valid JSON (raw or base64)`);
    }
  }
}

function parseRecipe(raw: string): Recipe {
  const r = decodeJson<Recipe>(raw, "ROUTING_RECIPE_PUBLIC");
  for (const band of ["low", "med", "high"] as const) {
    if (!r?.bands?.[band]?.models?.length) {
      throw new Error(`ROUTING_RECIPE_PUBLIC missing models for band "${band}"`);
    }
  }
  return r;
}

function parseWorkers(raw: string): Record<string, string> {
  const w = decodeJson<Record<string, string>>(raw, "WORKERS_PUBLIC");
  for (const [model, url] of Object.entries(w)) {
    if (!/^https?:\/\//.test(url)) throw new Error(`WORKERS_PUBLIC[${model}] is not a URL`);
    w[model] = url.replace(/\/+$/, "");
  }
  return w;
}

// Every model any band can choose must have a registered attested worker,
// or the chain cannot close for that route.
function assertWorkersCoverRecipe(recipe: Recipe, workers: Record<string, string>): void {
  const referenced = new Set(Object.values(recipe.bands).flatMap((b) => b.models));
  const missing = [...referenced].filter((m) => !workers[m]);
  if (missing.length) {
    throw new Error(`no attested worker registered for models: ${missing.join(", ")}`);
  }
}

import express from "express";
import { randomUUID } from "node:crypto";
import { canonicalize, hash, walletFromPhrase } from "../crypto.js";
import { cors } from "../cors.js";
import { runPolicy, transpile } from "./sandbox.js";
import { score, type HiddenTask, type ModelCard, type Params } from "./score.js";
import { makeOpenRouter } from "./infer.js";

// ---- boot / config -------------------------------------------------------
if (!process.env.MNEMONIC) throw new Error("MNEMONIC missing — not in a provisioned enclave");
if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing — needed for live inference");
const wallet = walletFromPhrase(process.env.MNEMONIC);
const graderModel = process.env.GRADER_MODEL ?? "openai/gpt-4o-mini";

// Anti-copy: reject a policy that's an unmodified starter/example. Normalize
// away comments + ALL whitespace first, so you can't bypass it by adding a
// space or a comment — the actual routing logic has to change.
// STARTER_POLICY_HASHES = comma-separated hash(normalizePolicy(starter)) values.
function normalizePolicy(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/\/\/[^\n]*/g, "")          // line comments
    .replace(/\s+/g, "");                // all whitespace
}
const STARTER_HASHES = new Set(
  (process.env.STARTER_POLICY_HASHES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);

function decodeJson<T>(name: string, raw?: string): T {
  if (!raw) throw new Error(`${name} is required`);
  try { return JSON.parse(raw) as T; }
  catch { try { return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as T; }
    catch { throw new Error(`${name} is not valid JSON (raw or base64)`); } }
}

const catalog = decodeJson<{ scoring: Params; models: ModelCard[] }>("CATALOG_PUBLIC", process.env.CATALOG_PUBLIC);
const hidden = decodeJson<{ prompts: HiddenTask[] }>("HIDDEN_SET", process.env.HIDDEN_SET_B64);
const params = catalog.scoring;
const models = catalog.models;
const infer = makeOpenRouter(process.env.OPENROUTER_API_KEY!, graderModel, Object.fromEntries(models.map((m) => [m.id, m])));
const benchmarkName = process.env.BENCHMARK_NAME_PUBLIC ?? "autorouter-arena";
const version = process.env.ROUTER_VERSION_PUBLIC ?? "1.0.0";

const catalogHash = hash(canonicalize({ models, scoring: params }));
// eval_set_hash commits to which tasks AND their grading rubric (the rubric steers the score).
const evalSetHash = hash(canonicalize(hidden.prompts.map((p) => ({ id: p.id, text: p.text, rubric: p.rubric })).sort((a, b) => a.id.localeCompare(b.id))));
const sandboxPrompts = hidden.prompts.map((p) => ({ id: p.id, text: p.text, signals: p.signals })); // rubric withheld from the policy

interface Stored {
  submission_id: string; participant: string; note: string; score: number;
  policy_hash: string; timestamp: number;
  receipt: unknown; canonical: string; signature: string; rows: unknown;
}
const CAP = 5000;
const submissions: Stored[] = [];

// ---- app -----------------------------------------------------------------
const app = express();
app.use(cors);
app.use(express.json({ limit: "512kb" }));

app.get("/health", (_req, res) => res.json({ ok: true, grader: wallet.address, benchmark: benchmarkName, eval_set_hash: evalSetHash }));
app.get("/pubkey", (_req, res) => res.json({ address: wallet.address }));

app.get("/benchmark", (_req, res) => res.json({
  name: benchmarkName, version,
  models, scoring_params: params, grader_model: graderModel,
  n_prompts: hidden.prompts.length,
  eval_set_hash: evalSetHash, catalog_hash: catalogHash,
  objective: "score = mean_quality - lambda*mean_cost + beta*oss_rate",
}));

// POST /submit { policy: "<TS source>", participant, note? }
app.post("/submit", async (req, res) => {
  const { policy, participant, note } = req.body ?? {};
  if (typeof policy !== "string" || !policy.trim()) return res.status(400).json({ error: "policy (TS source) required" });
  if (typeof participant !== "string" || !participant.trim()) return res.status(400).json({ error: "participant required" });
  if (STARTER_HASHES.has(hash(normalizePolicy(policy)).toLowerCase()))
    return res.status(400).json({ error: "This is an unmodified starter/example policy. Change the routing logic in decide() and resubmit — the same code can't be scored twice." });

  let js: string;
  try { js = transpile(policy); } catch (e) { return res.status(400).json({ error: `transpile failed: ${(e as Error).message}` }); }

  const run = await runPolicy(js, sandboxPrompts, models);
  if (!run.ok || !run.decisions) return res.status(400).json({ error: run.error ?? "policy failed" });

  const scored = await score(run.decisions, hidden.prompts, models, params, infer);
  const submission_id = randomUUID();
  const results_root = hash(canonicalize(scored.rows));

  const receipt = {
    version: "1",
    submission_id,
    participant,
    note: typeof note === "string" ? note.slice(0, 200) : "",
    policy_hash: hash(policy),
    eval_set_hash: evalSetHash,
    catalog_hash: catalogHash,
    scoring_params: params,
    n_prompts: hidden.prompts.length,
    mean_quality: round(scored.mean_quality),
    mean_cost: round(scored.mean_cost, 6),
    oss_rate: round(scored.oss_rate),
    invalid: scored.invalid,
    score: round(scored.score),
    results_root,
    grader_address: wallet.address,
    grader_model: graderModel,
    timestamp: Date.now(),
  };
  const canonical = canonicalize(receipt);
  const signature = await wallet.signMessage(canonical);

  submissions.push({
    submission_id, participant, note: receipt.note, score: receipt.score,
    policy_hash: receipt.policy_hash, timestamp: receipt.timestamp,
    receipt, canonical, signature, rows: scored.rows,
  });
  if (submissions.length > CAP) submissions.shift();

  res.json({ submission_id, score: receipt.score, mean_quality: receipt.mean_quality, mean_cost: receipt.mean_cost, oss_rate: receipt.oss_rate, invalid: receipt.invalid, receipt, signature, grader_address: wallet.address });
});

app.get("/submissions", (req, res) => {
  const who = String(req.query.participant ?? "");
  const list = submissions.filter((s) => !who || s.participant === who)
    .slice(-100).reverse()
    .map((s) => ({ submission_id: s.submission_id, participant: s.participant, score: s.score, policy_hash: s.policy_hash, note: s.note, timestamp: s.timestamp }));
  res.json({ submissions: list });
});

app.get("/submission/:id", (req, res) => {
  const s = submissions.find((x) => x.submission_id === req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json({ receipt: s.receipt, canonical: s.canonical, signature: s.signature, grader_address: wallet.address, rows: s.rows });
});

app.get("/leaderboard", (_req, res) => {
  // best score per participant
  const best = new Map<string, Stored>();
  for (const s of submissions) { const b = best.get(s.participant); if (!b || s.score > b.score) best.set(s.participant, s); }
  const board = [...best.values()].sort((a, b) => b.score - a.score)
    .map((s, i) => ({ rank: i + 1, participant: s.participant, score: s.score, submission_id: s.submission_id, policy_hash: s.policy_hash }));
  res.json({ benchmark: benchmarkName, leaderboard: board });
});

function round(n: number, d = 4): number { return Math.round(n * 10 ** d) / 10 ** d; }

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`autorouter-grader v${version} listening on :${port} | grader=${wallet.address} | benchmark=${benchmarkName} | n=${hidden.prompts.length} | eval_set_hash=${evalSetHash}`);
});

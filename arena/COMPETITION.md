# AutoRouter Arena — competition spec

An open competition to build the best **LLM routing policy**. You write only the routing brain; the organizer runs a fixed, **attested** conductor + worker fleet on EigenCompute and grades your policy against a **hidden prompt set**. Because grading happens inside a TEE and the score is signed, the leaderboard is **un-gameable** — no one, including the organizer, can fake a number.

Built on [attested-vllm-router](../README.md). The router there is the infrastructure; here it's the referee.

---

## 1. Roles

- **Organizer** — runs the attested **grader** (conductor + worker fleet in Intel TDX), holds the secret eval set, publishes the public dev set + model catalog, maintains the leaderboard.
- **Participant** — writes a routing **policy** (`decide()`), iterates locally against the public dev set (via the [skill](./skill/autorouter/SKILL.md)), then submits. Never sees the eval prompts.

The prompt is gatekept: your *code* sees each prompt at routing time (it has to, to route), but *you* never see the eval set — so you can't overfit or hardcode. You optimize a general policy.

## 2. What you submit

One file — `policy.ts` — implementing a single pure function against [`types.ts`](./types.ts):

```ts
export function decide(prompt: PromptView, models: ModelCard[]): Decision;
// Decision = { looper: "single"|"confidence"|"ratings"|"remom", candidates: string[] }
```

You pick *which* models to consider and *how* to combine them (the looper). The grader runs them for you. Start from [`policy.template.ts`](./policy.template.ts).

### Rules (enforced by the grader sandbox)
- **Pure & deterministic.** No network, no filesystem, no clock, no randomness. Same policy → same `policy_hash` → reproducible score.
- **Runs in an isolate** (`isolated-vm`): no Node/host APIs, a per-call CPU timeout, no way to read other submissions or phone home.
- **You may only route to catalog models.** Returning an unknown model id scores that prompt 0.
- Optional: you may also export `extractSignals(prompt)` to compute your own features; otherwise the default signals are provided.

## 3. Models & the open-source incentive

The catalog ([`config/catalog.json`](./config/catalog.json)) tags each model with a `tier` and `price_per_call`:

| tier | example | price | open_source |
|---|---|---|---|
| `open-free` | `llama-3.3-70b:free`, `qwen2.5-7b:free` | 0 | ✓ |
| `open-paid` | `mistral-large` | low | ✓ |
| `proprietary` | `gpt-4o` | high | ✗ |

Free/open models cost nothing **and** earn the openness bonus — so the competition actively promotes open and free models. The winning strategy is: **solve it on a free OSS model whenever it's good enough; only spend on proprietary when the quality gain is worth it.**

## 4. Scoring

For each prompt the grader runs your chosen looper, judges the final answer's quality `q ∈ [0,1]` (fixed judge model, temperature 0), and sums the `price_per_call` of every model the looper actually invoked (escalations and fan-outs cost more).

Aggregated over `N` prompts:

```
score = mean(quality)  −  λ · mean(cost)  +  β · oss_rate
```

- `mean(quality)` — how good the answers are.
- `mean(cost)` — average $ spent per prompt (free models = 0).
- `oss_rate` — fraction of prompts whose *chosen* model is open-source.
- `λ` (cost penalty) and `β` (openness bonus) are published in the catalog (`λ=4.0`, `β=0.15` on the dev set).

Intuition: routing an easy prompt to a free OSS model gets full quality at zero cost **and** the openness bonus. Escalating a hard prompt to `gpt-4o` costs `λ·price` — worth it only if it lifts quality by more than that. That tension is the game.

### Looper cost model
- `single` — 1 call (`candidates[0]`).
- `confidence` — call candidates in order; stop at the first whose confidence ≥ threshold; cost = calls made. Escalation only costs when it happens.
- `ratings` — call all candidates; best answer wins; cost = sum of all.
- `remom` — all candidates + an aggregator (`candidates[0]`); the aggregator IS the result, so quality/cost/openness attribute to it (no best-of-all bonus); highest cost.

## 5. Local testing (before you submit)

The public dev set ([`dev/devset.json`](./dev/devset.json)) ships **precomputed per-model `{quality, confidence}`** for every prompt, so local scoring is instant, offline, deterministic, and free — you optimize routing over known outcomes:

```bash
node --import tsx arena/run.mjs arena/policy.ts
```

Or load the **[autorouter skill](./skill/autorouter/SKILL.md)** and let Claude scaffold, run, and iterate your policy with you. The hidden set is scored the exact same way — inside the TEE.

## 6. Submission & the signed score receipt

`autorouter submit` hashes your `policy.ts`, uploads it, and the grader runs it against the hidden set inside the enclave, then signs:

```jsonc
ScoreReceipt {
  version, submission_id, participant,
  policy_hash,            // keccak256 of your canonical policy
  eval_set_id, eval_set_hash,    // committed before the round; set revealed at close
  catalog_hash, judge_model, scoring_params,   // { lambda, beta, threshold }
  results_root,           // merkle root of per-prompt { id, chosen_model, quality, cost }
  worker_attestations_root,      // every graded inference is itself worker-signed
  mean_quality, mean_cost, oss_rate, score,
  graded_at
}
// signed by the grader enclave key (a Derived Address on the Verifiability Dashboard)
```

Anyone verifies a leaderboard entry with `ethers.verifyMessage` → it recovers the grader's on-chain Derived Address. After the round closes, the eval set is revealed and `eval_set_hash` checked, so the score can be **recomputed and audited** end to end.

## 7. Integrity — why the leaderboard can't be gamed

| Threat | Defense |
|---|---|
| Participant fakes a high score | Score is signed by the grader enclave; only its KMS-derived key can sign, and it only runs inside a measured image. |
| Participant overfits the eval set | Eval set is hidden; policy runs in an isolate with no net/fs, so it can't exfiltrate or enumerate prompts. |
| Organizer fudges a score | Same enclave key + `results_root`; the score is recomputable from the revealed set. |
| Organizer cherry-picks prompts after seeing entries | `eval_set_hash` is committed *before* the round opens. |
| Grader claims a model it didn't run | Each inference carries its worker's own attestation (`worker_attestations_root`). |
| Malicious policy code | `isolated-vm`: no host APIs, CPU timeout, blast radius = a bad routing choice, nothing more. |

## 8. What the organizer still builds

This repo ships the **participant side** (interface, dev set, local scorer, skill). To run a live competition the organizer adds:

- [ ] **Grader service** — wraps the attested conductor: accept `policy.ts`, run it in `isolated-vm` per hidden prompt, drive the worker fleet, judge, aggregate, sign the `ScoreReceipt`.
- [ ] **Hidden eval set + judge** — fixed judge model (temp 0) with a rubric or reference answers; commit `eval_set_hash` per round.
- [ ] **Submission API + leaderboard** — store signed receipts; a public verifier page.
- [ ] **Isolate integration** — `isolated-vm` (the local scorer trusts your own machine and skips this).

The scoring math, receipt shape, and catalog here are the source of truth the grader implements — the local scorer (`run.mjs`) is a faithful, runnable reference of exactly what the grader computes.

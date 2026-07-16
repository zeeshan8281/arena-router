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

**Tasks are multi-stage.** Each hidden task is an ordered set of stages (e.g. `plan → implement → test → review`). `decide()` is called **once per stage**; `prompt.stage` = `{ kind, index, total }`. The grader runs your chosen model on the stage prompt with the prior stages' output as context, chains them, and grades the **final transcript**. Route per stage — cheap for planning/review, a `code`/stronger model for `implement`/`debug`. Routing sees stage metadata only; you never see prior output.

**Your policy must be your own.** The grader rejects any submission byte-identical to the shipped starter/example (comments + whitespace are normalized away) — change `decide()` first.

### Rules (enforced by the grader sandbox)
- **Pure & deterministic.** No network, no filesystem, no clock, no randomness. Same policy → same `policy_hash` → reproducible score.
- **Runs in an isolate** (`isolated-vm`): no Node/host APIs, a per-call CPU timeout, no way to read other submissions or phone home.
- **You may only route to catalog models.** Returning an unknown model id scores that prompt 0.
- Optional: you may also export `extractSignals(prompt)` to compute your own features; otherwise the default signals are provided.

## 3. Models — all open, quality vs compute

Every model in the catalog ([`config/catalog.json`](./config/catalog.json)) is **open-source and free to call**. So there is no "pay for a proprietary model" choice — the tension is **quality vs compute**. Each model has a `tier` (capability class) and a `price_per_call` that is a **compute-cost proxy**: a bigger, stronger model costs more compute per call.

| tier | example | compute cost |
|---|---|---|
| `tiny` | `llama-3.2-3b` | lowest |
| `small` | `nemotron-nano-9b` | low |
| `mid` | `gpt-oss-20b` | medium |
| `code` | `qwen3-coder` | medium (code specialist) |
| `large` | `llama-3.3-70b` | highest |

The winning strategy: **solve it on the smallest model that's good enough; escalate to a bigger one only when the quality gain outweighs the compute it costs.**

## 4. Scoring

For each prompt the grader runs your chosen looper, calls the routed model(s) live, judges the final answer's quality `q ∈ [0,1]` with a fixed paid judge model, and sums the `price_per_call` of every model the looper actually invoked (escalations and fan-outs cost more compute).

Aggregated over `N` prompts:

```
score = mean(quality)  −  λ · mean(cost)
```

- `mean(quality)` — how good the answers are.
- `mean(cost)` — average compute spent per prompt.
- `λ` (cost penalty) is published in the catalog (`λ=4.0` on the dev set). The openness bonus `β` is `0` — every model is open, so there's nothing to differentiate on openness.

Intuition: routing an easy prompt to a `tiny` model gets near-full quality at minimal compute. Escalating a hard prompt to `large` costs `λ·price` — worth it only if it lifts quality by more than that. That tension is the game.

### Looper cost model
- `single` — 1 call (`candidates[0]`).
- `confidence` — call candidates in order; stop at the first whose confidence ≥ threshold; cost = calls made. Escalation only costs when it happens.
- `ratings` — call all candidates; best answer wins; cost = sum of all.
- `remom` — all candidates + an aggregator; small quality synergy; highest cost.

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
  version, submission_id, participant, note,
  policy_hash,            // keccak256 of your canonical policy source
  eval_set_hash,          // commits to the hidden tasks + rubrics; revealed at close
  catalog_hash, grader_model, scoring_params,   // { lambda, beta, threshold }
  n_prompts, results_root,   // keccak256 of per-prompt { id, chosen_model, quality, cost }
  mean_quality, mean_cost, oss_rate, invalid, score,
  grader_address, timestamp
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

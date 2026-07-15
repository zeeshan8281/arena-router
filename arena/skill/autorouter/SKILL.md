---
name: autorouter
description: "Use when helping a participant compete in the AutoRouter Arena via the autorouter CLI: login, config, benchmark, clone, setup, run (local score on the public dev set), submit (attested grading on the hidden set → signed score), submissions, leaderboard, verify. Also use when the user is writing a routing policy (decide()), mentions the arena, or wants to test a router before submitting."
---

# AutoRouter Arena — CLI usage

Operate the `autorouter` CLI to compete in the AutoRouter Arena. The participant writes one file — `policy.ts`, exporting `decide(prompt, models)` — iterates it locally, then submits for an **attested** score signed by the grader enclave. Read `arena/COMPETITION.md` for full rules before giving strategy advice.

## The objective (hold this in mind for every suggestion)

```
score = mean(quality) − λ·mean(cost)
```

Every model is open-source and free to call, so the game is **quality vs compute**: `price_per_call` is a compute-cost proxy (bigger model = more). Winning move: solve each stage on the **smallest model that's good enough**; only escalate to a bigger one when the quality gain beats `λ·price`. Never blindly send everything to the strongest model — it tanks the cost term.

## Tasks are multi-stage

Each hidden task is an ordered set of **stages** (e.g. `plan → implement → test → review`). `decide()` is called **once per stage** and `prompt.stage` tells you which one (`{ kind, index, total }`). The grader runs your chosen model on the stage prompt **with the prior stages' output as context**, chains them, and an LLM judge grades the **final transcript** against a hidden rubric. So route per stage: cheap models for planning/review, a `code`-tier or stronger model for `implement`/`debug`. Routing may key on stage metadata only — you never see prior stage output (the grader feeds it to the model, not to you).

## Setup

```bash
autorouter login <handle> --api <grader-url>   # identity + grader endpoint
autorouter config                              # show resolved api + handle
autorouter benchmark                           # models, params (λ, β, threshold), hidden-set hash
```

## Get a workspace and iterate

```bash
autorouter clone [dir]        # scaffolds policy.ts (+ types, dev set, scorer) into dir
autorouter setup              # installs tsx (local scorer needs it)
# edit policy.ts ...
autorouter run [policy.ts]    # score locally on the PUBLIC dev set — the core loop
```

`run` prints a per-prompt table (looper, chosen model, #calls, quality, compute cost) and the SCORE. Read it for waste:
- easy prompt sent to a big model? move it to the smallest tier that still nails it.
- hard prompt stuck on a small model with low quality? escalate (confidence looper with a bigger model appended), but only if the quality gain beats the compute.
- using `ratings`/`remom`? they call multiple models — only justify on the hardest prompts.
Re-run. Chase a higher SCORE, not just higher quality.

## Submit (attested)

```bash
autorouter submit [policy.ts] --note "what I changed"
```

**Your policy must be your own.** The grader rejects any submission byte-identical to the shipped starter/example (comments and whitespace are normalized away, so you can't bypass it with a space) — actually change the routing logic in `decide()` first.

The grader runs your policy against the **hidden** set inside a TEE and returns a **signed** score; the CLI verifies the signature against the grader's enclave address before printing it. Then:

```bash
autorouter submissions               # your scores
autorouter leaderboard               # best score per participant
autorouter verify <submission_id>    # re-check any submission's enclave signature
```

## What counts as a good policy

The hidden set is different from the dev set — write a **general rule** (signals → looper + candidates), not per-prompt hacks (you can't see the hidden prompts anyway). The graded score is signed by the enclave and recomputable after the set is revealed, so there's nothing to game. Local `run` and the grader use identical math, so a higher local score is a faithful (not exact) predictor.

## Rules the grader sandbox enforces
`decide()` must be **pure** — no `fetch`, `fs`, `import` beyond `./types`, `Date`, `Math.random`, or `process`. It runs under SES capability isolation in a worker thread with a CPU timeout; violations either do nothing (globals are undefined) or get the submission killed.

## Files (in a cloned workspace / `arena/`)
- `policy.ts` — your submission (from `policy.template.ts`)
- `types.ts` — the `decide()` interface
- `config/catalog.json` — models, prices, scoring params
- `dev/devset.json` — public dev prompts with precomputed outcomes
- `run.mjs` / `score.mjs` — the local scorer (mirrors the grader)
- `cli/autorouter.mjs` — the CLI
- `COMPETITION.md` — full rules, scoring, attestation, integrity

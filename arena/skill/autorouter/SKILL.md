---
name: autorouter
description: "Use when helping a participant compete in the AutoRouter Arena via the autorouter CLI: login, config, benchmark, clone, setup, run (local score on the public dev set), submit (attested grading on the hidden set → signed score), submissions, leaderboard, verify. Also use when the user is writing a routing policy (decide()), mentions the arena, or wants to test a router before submitting."
---

# AutoRouter Arena — CLI usage

Operate the `autorouter` CLI to compete in the AutoRouter Arena. The participant writes one file — `policy.ts`, exporting `decide(prompt, models)` — iterates it locally, then submits for an **attested** score signed by the grader enclave. Read `arena/COMPETITION.md` for full rules before giving strategy advice.

## The objective (hold this in mind for every suggestion)

```
score = mean(quality) − λ·mean(cost) + β·oss_rate
```

Free/open models cost 0 **and** earn the openness bonus. Winning move: route to a **free open-source** model whenever it's good enough; only escalate to a paid/proprietary model when the quality gain beats `λ·price`. Never blindly send everything to the strongest model — it tanks cost and oss_rate.

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

`run` prints a per-prompt table (looper, chosen model, #calls, quality, cost, oss) and the SCORE. Read it for waste:
- cheap prompt → paid model? move it to a free model.
- hard prompt stuck on a free model with low quality? escalate (confidence looper with a strong model appended), but only if the quality gain beats the cost.
- using `ratings`/`remom`? they call multiple models — only justify on the hardest prompts.
Re-run. Chase a higher SCORE, not just higher quality.

## Submit (attested)

```bash
autorouter submit [policy.ts] --note "what I changed"
```

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

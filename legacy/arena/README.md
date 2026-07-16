# AutoRouter Arena — participant starter kit

Build the best **LLM routing policy**. You write one function; an attested grader on EigenCompute scores it against a hidden prompt set and signs the result, so the leaderboard can't be faked. Full rules: **[COMPETITION.md](./COMPETITION.md)**.

> **Live grader:** `http://34.136.240.56:8080` · enclave key `0xBac4Dd2D…` · [dashboard](https://verify-sepolia.eigencloud.xyz/app/0xa2b59f7988Dc1611d5df3F1FcDf3080daa50d2De) — the CLI defaults to it.

## Quickstart (CLI)

```bash
npm i -g ./arena            # installs the `autorouter` CLI  (or: node arena/cli/autorouter.mjs <cmd>)

autorouter login <handle> --api <grader-url>
autorouter benchmark        # see models, scoring params, hidden-set hash
autorouter clone my-router  # scaffold a policy workspace
cd my-router
autorouter setup            # installs tsx
# edit policy.ts ...
autorouter run              # score locally on the PUBLIC dev set
autorouter submit --note "baseline"   # grade on the HIDDEN set inside the TEE → signed score
autorouter leaderboard
```

Onboarding mirrors [FrontierCS](https://openfrontiercs.com): `login → clone → setup → run → submit`. The difference: `submit` returns a **cryptographically signed** score (verifiable against the grader's on-chain enclave address), not a trust-the-organizer number.

## Let Claude iterate with you

```bash
cp -r arena/skill/autorouter ~/.claude/skills/autorouter
```

Then ask Claude to improve your policy — it drives the CLI (`run`/`submit`), reads the per-prompt breakdown, and suggests routing changes aimed at the objective: *quality per cost, leaning on free/open models*.

## The one rule to internalize

```
score = mean(quality) − λ·mean(cost) + β·oss_rate
```

Free open-source models cost nothing and earn the openness bonus. Route to them whenever they're good enough; only pay for a proprietary model when it clearly buys quality. That tradeoff is the whole game.

## What's here

| file | what |
|---|---|
| `cli/autorouter.mjs` | the CLI (`login/benchmark/clone/run/submit/leaderboard/verify`) |
| `policy.template.ts` | starter policy — `clone` copies it to `policy.ts` |
| `types.ts` | the interface your `decide()` implements |
| `config/catalog.json` | models, prices, scoring params |
| `dev/devset.json` | public dev prompts + precomputed per-model outcomes |
| `run.mjs` / `score.mjs` | local scorer (mirrors the grader's math exactly) |
| `skill/autorouter/` | Claude Code skill that drives the CLI |
| `COMPETITION.md` | full spec: scoring, loopers, attestation, integrity |

> The grader (`src/grader/`) runs on EigenCompute: it sandboxes your policy with **SES** in a worker thread, scores it on the sealed hidden set, and signs the `ScoreReceipt` with its enclave key.

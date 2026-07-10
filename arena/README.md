# AutoRouter Arena — participant starter kit

Build the best **LLM routing policy**. You write one function; an attested grader on EigenCompute scores it against a hidden prompt set and signs the result, so the leaderboard can't be faked. Full rules: **[COMPETITION.md](./COMPETITION.md)**.

## Quickstart

```bash
npm i -D tsx                       # once (if not already installed)
cp arena/policy.template.ts arena/policy.ts
# edit arena/policy.ts ...
node --import tsx arena/run.mjs arena/policy.ts
```

You'll get a per-prompt table and a SCORE. Improve the score, repeat.

## Let Claude iterate with you

Install the skill, then just ask Claude to improve your policy:

```bash
cp -r arena/skill/autorouter ~/.claude/skills/autorouter
```

Claude will scaffold `policy.ts`, run the scorer, read the breakdown, and suggest routing changes aimed at the objective — *quality per cost, leaning on free/open models*.

## The one rule to internalize

```
score = mean(quality) − λ·mean(cost) + β·oss_rate
```

Free open-source models cost nothing and earn the openness bonus. Route to them whenever they're good enough; only pay for a proprietary model when it clearly buys quality. That tradeoff is the whole game.

## What's here

| file | what |
|---|---|
| `policy.template.ts` | starter policy — copy to `policy.ts` |
| `types.ts` | the interface your `decide()` implements |
| `config/catalog.json` | models, prices, scoring params |
| `dev/devset.json` | public dev prompts + precomputed per-model outcomes |
| `run.mjs` | local scorer (mirrors the grader's math exactly) |
| `skill/autorouter/` | Claude Code skill for guided iteration |
| `COMPETITION.md` | full spec: scoring, loopers, attestation, integrity |

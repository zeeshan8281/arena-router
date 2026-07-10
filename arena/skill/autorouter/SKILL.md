---
name: autorouter
description: Iterate on an AutoRouter Arena routing policy locally — scaffold policy.ts, score it against the public dev set, improve the score (quality per cost, promote open/free models), validate, and submit. Use when the user is working on an autorouter competition policy, mentions "arena", "routing policy", "decide()", or wants to test a router before submitting.
---

# AutoRouter Arena — local iteration

You help a participant build a routing **policy** for the AutoRouter Arena. They submit one file, `policy.ts`, exporting `decide(prompt, models)`. You iterate it locally against the public dev set; the real competition grades the same way inside a TEE. Read `arena/COMPETITION.md` for the full rules before giving strategy advice.

## The objective (keep this in mind for every suggestion)

```
score = mean(quality) − λ·mean(cost) + β·oss_rate
```

Free/open models cost 0 **and** earn the openness bonus. So the winning move is: route to a **free open-source** model whenever it's good enough, and only escalate to a paid/proprietary model when the quality gain outweighs `λ·price`. Never blindly send everything to the strongest model — that tanks cost and oss_rate.

## Workflow

### 1. Scaffold
If `arena/policy.ts` doesn't exist, copy the template:
```bash
cp arena/policy.template.ts arena/policy.ts
```

### 2. Run the scorer (this is the core loop)
```bash
node --import tsx arena/run.mjs arena/policy.ts
```
It prints a per-prompt table (looper, chosen model, #calls, quality, cost, oss) and the final SCORE with its three components. Requires `tsx` (`npm i -D tsx` if missing).

### 3. Read the breakdown and improve
Look at the table for waste:
- **A cheap prompt routed to a paid model** → move it to a free model (saves cost, gains oss).
- **A hard prompt stuck on a free model with low quality** → escalate (confidence looper with a strong model appended), but only if the quality gain beats the cost penalty.
- **`confidence` never escalating / always escalating** → tune which models you list and their order; escalation cost is paid only when it fires.
- **Using `ratings`/`remom`** → they call multiple models (high cost); only justify them on the hardest prompts.
Then re-run step 2. Chase a higher SCORE, not just higher quality.

### 4. Validate before submitting
Re-run the scorer and confirm: no `INVALID` rows (every returned candidate is a real catalog id), and `decide()` stays pure — **no** `fetch`, `fs`, `import` beyond `./types`, `Date`, `Math.random`, or `process`. The grader's sandbox rejects those; the score is only reproducible if the policy is deterministic.

### 5. Submit
```bash
autorouter submit arena/policy.ts        # (organizer CLI — endpoint per the competition)
```
The grader runs the policy against the hidden set inside the enclave and returns a **signed** ScoreReceipt (verifiable against the grader's on-chain Derived Address). Until the organizer's submit endpoint is configured, submission is out of band — check the competition page.

## Strategy notes to offer

- The dev set has ~3 genuinely hard prompts (math/proof/algorithm) where free models are weak — those are the only ones usually worth escalating.
- `has_code` or `complexity_band === "high"` are good escalation triggers; low/med rarely are.
- Prefer the cheapest **open-free** model that clears the bar; the openness bonus (`β`) is free score.
- Don't overfit the dev numbers — the hidden set differs. Aim for a robust rule (signals → looper + candidates), not per-prompt hacks (you can't see the hidden prompts anyway).

## Files
- `arena/policy.template.ts` — starter, copy to `policy.ts`
- `arena/types.ts` — the exact interface (`PromptView`, `ModelCard`, `Decision`)
- `arena/config/catalog.json` — models, prices, scoring params (`λ`, `β`, threshold)
- `arena/dev/devset.json` — public dev prompts with precomputed per-model outcomes
- `arena/run.mjs` — the local scorer (faithful reference of the grader's math)
- `arena/COMPETITION.md` — full rules, scoring, attestation

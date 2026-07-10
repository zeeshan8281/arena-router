# AutoRouter Arena

**A competition to build the best LLM routing policy — scored by an attested grader on a hidden prompt set inside an Intel TDX enclave on [EigenCompute](https://www.eigencloud.xyz/), and cryptographically signed.** You write one function; the grader runs it, scores it, and signs the result. The leaderboard is verifiable — no one, not even the organizer, can fake a number.

### 🔗 Live (EigenCompute · Sepolia)

| | Link |
|---|---|
| 🏆 **Arena** — benchmark, how grading works, participate, leaderboard | **https://arena-router-ui.vercel.app** |
| 🏟️ **Grader** — sandboxes your policy, signs the score | `http://34.136.240.56:8080` · [attestation ↗](https://verify-sepolia.eigencloud.xyz/app/0xa2b59f7988Dc1611d5df3F1FcDf3080daa50d2De) |

---

## How it works

1. **You write a policy** — one function, `decide(prompt, models)`, that picks which model handles each request and how to combine them (`single`, `confidence`, `ratings`, `remom`).
2. **You never see the prompts.** The eval set is sealed (KMS-encrypted, decrypts only in the enclave), so you can't overfit — you write a *general* rule.
3. **The grader scores it in a TEE.** Your `decide()` runs under **SES** capability isolation (no `fetch`/`fs`/`process`; a hang is killed by timeout) over the hidden set, and the grader **signs** `{policy_hash, eval_set_hash, results_root, score}` with a key that only exists inside the measured image.
4. **Anyone verifies.** `ethers.verifyMessage` recovers the grader's on-chain Derived Address; after the round the set is revealed and the score is recomputable. Nothing to trust.

## Scoring

```
score = mean(quality) − λ·mean(cost) + β·oss_rate
```

Free / open-source models cost **0** *and* earn the openness bonus, so the winning move is: solve it on a free OSS model whenever it's good enough, and only spend on a proprietary model when the quality gain beats the cost.

## Participate (CLI)

```bash
git clone https://github.com/zeeshan8281/arena-router && cd arena-router && npm i -g ./arena

autorouter login <handle>          # defaults to the live grader
autorouter benchmark               # models, params, hidden-set hash
autorouter clone my-router && cd my-router
autorouter run                     # score locally on the PUBLIC dev set (instant, offline)
autorouter submit --note "v1"      # graded on the HIDDEN set in the TEE → signed score
autorouter leaderboard
```

Prefer an AI pair? `cp -r arena/skill/autorouter ~/.claude/skills/` and Claude drives the loop with you. Or use the browser quick-try on the [Arena site](https://arena-router-ui.vercel.app). Full rules, scoring math, attestation and anti-cheat: **[arena/COMPETITION.md](./arena/COMPETITION.md)**.

## Why the score can't be gamed

| threat | defense |
|---|---|
| Participant fakes a score | signed by the grader enclave; only its KMS-derived key can sign, only inside a measured image |
| Participant overfits the hidden set | set is sealed; policy runs in an isolate with no net/fs, so it can't read or leak prompts |
| Organizer fudges a score | same enclave key + `results_root`; recomputable from the revealed set |
| Organizer cherry-picks prompts | `eval_set_hash` is committed before the round |
| Malicious policy code | SES capability isolation + CPU timeout — blast radius is a bad routing choice, nothing more |

## Loopers (routing strategies you can use)

| looper | behavior |
|---|---|
| `single` | route to the first candidate |
| `confidence` | escalate to the next model when confidence (logprob-based) is below threshold |
| `ratings` | fan out to all candidates, pick the best |
| `remom` | repeated Mixture-of-Agents: propose → synthesize × N rounds |

## Built on the attested router

The grader is layered on the [attested-vllm-router](https://github.com/zeeshan8281/attested-vllm-router) — a semantic router whose conductor and worker enclaves sign a receipt for every routing decision and inference. The Arena reuses that trust primitive (enclave-signed receipts) for competition scores. You don't need it to compete — it's the foundation the grader stands on.

## Layout

```
arena/
  cli/autorouter.mjs     the CLI (login/benchmark/clone/run/submit/leaderboard/verify)
  policy.template.ts     the decide() you implement · types.ts is the interface
  run.mjs / score.mjs    local scorer (mirrors the grader's math)
  dev/devset.json        public dev prompts with precomputed per-model outcomes
  config/catalog.json    models, prices, scoring params
  skill/autorouter/      Claude Code skill that drives the CLI
  COMPETITION.md         full spec
src/grader/              the attested grader (SES sandbox + signed ScoreReceipt)
ui/                      the Arena site (Vite + ethers)
```

## Honest boundary

The grader scores routing over **precomputed per-model outcomes** on the hidden set — the routing decision is what's tested, and the attestation (sandbox, sealed set, signed score) is fully real. Swapping in live inference + an LLM judge is a scoped upgrade that reuses the same signing path.

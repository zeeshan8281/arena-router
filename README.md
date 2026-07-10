# Arena Router

**A verifiable LLM router — and a competition to build the best routing policy for it — running end‑to‑end inside Intel TDX enclaves on [EigenCompute](https://www.eigencloud.xyz/).** Every routing decision, every model inference, and every competition score is signed by an enclave‑bound key. Nothing is "trust me": you verify it yourself.

Two things live in this repo, sharing one trust primitive (signed receipts):

1. **The Attested Router** — a semantic router that signs a receipt for every request: *which model it chose, under which policy, and that that model produced the output.*
2. **The AutoRouter Arena** — a competition where you write a routing **policy**; an attested grader scores it on a **hidden** prompt set and **signs** the score, so the leaderboard can't be faked.

### 🔗 Live (EigenCompute · Sepolia)

| | Link |
|---|---|
| 🖥️ **Router UI** (visualizes + verifies the chain in your browser) | **https://arena-router-ui.vercel.app** · or http://34.6.165.194:8080 · local: `cd ui && npm i && npm run dev` |
| 🧭 **Conductor** — routing decision, signs the receipt | [dashboard](https://verify-sepolia.eigencloud.xyz/app/0x7F2EC821fbD68e8A20C7C01a9498b6C70bC9c896) |
| 🔒 **Worker (prover)** — runs the model, signs the inference | [dashboard](https://verify-sepolia.eigencloud.xyz/app/0xdb06a76f914513519217DCb4c7c6E1160238f600) |
| 🏟️ **Arena grader** — sandboxes a policy, signs the score | `http://34.136.240.56:8080` · [dashboard](https://verify-sepolia.eigencloud.xyz/app/0xa2b59f7988Dc1611d5df3F1FcDf3080daa50d2De) |

---

## Why a TEE (the whole point)

A signed receipt is worthless if the operator holds the key — they could sign any claim. EigenCompute closes that gap: the signing key is **KMS‑derived and only released inside a measured image**, the image digest is **published on‑chain**, and the signer is a **Derived Address** bound to the app. So a valid signature means *"this exact, publicly‑measured code, in a real enclave, produced this"* — not *"the operator says so."* Strip the TEE and every receipt becomes theater you could fake with a for‑loop.

## See it work in 60 seconds

**The router** — make a request, then have your browser recover every enclave signer:
```bash
C=http://34.143.160.145:8080
curl -s -X POST $C/v1/route -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hello"}]}' > mine.json
node scripts/verify.mjs $C $(node -e 'console.log(require("./mine.json").task_id)')
#  conductor: ✓  ·  worker: ✓  ·  ✓ CHAIN VERIFIED
```

**The arena** — write a policy, get a signed score on the hidden set:
```bash
npm i -g ./arena
autorouter login <handle>          # defaults to the live grader
autorouter clone my-router && cd my-router
autorouter run                     # score locally on the public dev set
autorouter submit --note "v1"      # graded on the HIDDEN set in the TEE → signed score
autorouter leaderboard
```

Or open the **UI** ([localhost:5174](http://localhost:5174) after `npm run dev`, or the live link) — it routes a prompt, visualizes `signals → policy → conductor ✍ → worker ✍`, verifies every signature client‑side, and has a **tamper toggle** that breaks a signature in one click.

## How the chain closes

The conductor never runs a model. Each model lives in its **own** enclave (a worker) with its **own** key and signs its own output; the conductor verifies those signatures and folds them into the receipt it signs.

```
            signs the routing receipt
  client ─▶ CONDUCTOR ───────────────────────────▶ signed receipt
               │  decide(policy) → looper + models    + worker_attestations[]
               │  call worker(s), VERIFY each sig
               ▼
           WORKER(s) ── one model / enclave, signs {model_id, response_hash}
```

The receipt's `response_hash` equals the worker attestation's — that shared hash binds *"the router chose X"* to *"the enclave running X produced exactly this."* Tamper with either and the enclosing signature breaks. `scripts/verify.mjs` walks the whole chain from one trace, trusting only public `/pubkey` endpoints and `ethers`.

## The Arena, in one line

```
score = mean(quality) − λ·mean(cost) + β·oss_rate
```

Free / open‑source models cost nothing **and** earn the openness bonus, so the winning move is: solve it with a free OSS model whenever it's good enough, and only spend on a proprietary model when the quality gain beats the cost. Participants submit a sandboxed `decide()` function (SES capability isolation, no `fetch`/`fs`/`process`, hard‑killed on timeout); the grader scores it on a sealed hidden set and signs `{policy_hash, eval_set_hash, score}`. Full rules, scoring, attestation and anti‑cheat: **[arena/COMPETITION.md](./arena/COMPETITION.md)**.

## Loopers (routing strategies)

| looper | behavior |
|---|---|
| `single` | route to the first candidate |
| `confidence` | escalate to the next model when confidence (logprob‑based) is below threshold |
| `ratings` | fan out to all candidates, pick the best |
| `remom` | repeated Mixture‑of‑Agents: propose → synthesize × N rounds |

## Honest boundaries

- **The routing decision is fully attested** — which model, under which policy, signed by measured enclave code.
- **The inference is attested to the enclave, not (yet) the weights.** The worker's `openai` backend calls OpenRouter *from inside its enclave* and signs the result — *"this measured enclave served this output for this model_id."* On‑device weight attestation needs a GPU‑capable TEE tier; the code path is identical (`WORKER_BACKEND=local`), only the hardware is missing.
- **The arena grader** uses precomputed per‑model outcomes on the hidden set (routing is what's tested); swapping in live inference + an LLM judge is a scoped upgrade — the attestation is already real.

## Layout

```
src/                     the router (one image, ROLE_PUBLIC picks the role)
  index.ts               conductor · worker/ · grader/ (SES sandbox + signed ScoreReceipt)
  crypto · signer · receipt · store · router/{signals,policy,loopers,workers}
scripts/verify.mjs       standalone chain verifier
ui/                      brand‑aligned (Eigen design system) React + ethers front‑end
arena/                   the competition: CLI, local scorer, dev set, policy interface, spec
  cli/autorouter.mjs · run.mjs · policy.template.ts · COMPETITION.md · skill/autorouter/
DEPLOY.md                EigenCompute deploy walkthrough (+ the gotchas)
```

## Deploy

One image, four roles (`ROLE_PUBLIC` = `conductor` | `worker` | `grader`; default conductor). Each is its own attested EigenCompute app with its own key. Full walkthrough — including the base64‑env and `--environment sepolia` gotchas — in **[DEPLOY.md](./DEPLOY.md)**.

---

*The router is the application; the signed receipts are the product; the TEE is what makes them evidence instead of decoration.*

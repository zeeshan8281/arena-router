# attested-vllm-router

**A semantic LLM router you don't have to trust.** It runs inside Intel TDX enclaves on [EigenCompute](https://www.eigencloud.xyz/), and it *cryptographically signs a receipt for every routing decision and every model inference* — so anyone can verify **which model was chosen, under which policy, and that that exact model produced the output**, without trusting the operator (that includes me).

> Live on EigenCompute Sepolia right now. Skip to [**Verify it yourself**](#verify-it-yourself) — you can check a real signed receipt from your terminal in about 60 seconds.

---

## The problem: an LLM router is a black box you're told to trust

"Semantic routers" (vLLM Semantic Router, RouteLLM, OpenRouter-style gateways) sit in front of a fleet of models and pick one per request: cheap model for easy prompts, frontier model for hard ones, maybe fan out and vote. Great for cost and latency.

But look at what you actually get back: an answer, and the operator's *word* on how it was produced.

- They say they routed your hard prompt to GPT‑4o. Did they? Or did they quietly serve gpt‑4o‑mini and pocket the difference?
- They publish a routing policy. Is that the policy that actually ran? Or a nicer-looking one than what's in production?
- They say "we don't log your prompts." Can you check?

Every one of those is "trust me." For a component that decides *which intelligence answers you* — and bills you accordingly — "trust me" is the entire security model. There's no artifact you can hold up and check.

## The idea: make the router emit proof, not promises

This router produces a **signed routing receipt** for every request:

```jsonc
{
  "task_id": "e01c1e31-…",
  "signals":  { "token_estimate": 31, "detected_lang": "en", "complexity_band": "high" },
  "policy_hash": "0x339bb5fa…",          // ties this receipt to a specific, published policy
  "looper": "confidence",
  "candidates_considered": ["openai/gpt-4o-mini", "openai/gpt-4o"],
  "chosen_model": "openai/gpt-4o-mini",
  "input_hash":  "0x8f503052…",          // keccak256 of your request — not the prompt itself
  "response_hash": "0x5356a5a2…",         // keccak256 of the answer
  "worker_attestations": [                // each model's OWN signature over what it produced
    { "model_id": "openai/gpt-4o-mini", "worker_address": "0x2f116ff2…",
      "response_hash": "0x5356a5a2…", "signature": "0xe4bdba5b…", "verified": true }
  ]
}
```

…and signs the whole thing with an enclave-bound key. Given only `{canonical, signature}` and `ethers`, anyone recovers the signer:

```js
ethers.verifyMessage(canonical, signature) === expectedAddress   // ✓ or the receipt was altered
```

No prompt or answer ever leaves the enclave — only their hashes. If *you* have the original, you can prove it matches the receipt; nobody else can read it.

## Why this is impossible without a TEE — i.e. why EigenCompute is load-bearing, not decoration

Here's the objection that kills most "signed AI output" schemes:

> A signature only proves the holder of the private key signed it. If the **operator** holds that key, the receipt proves nothing — they can sign *any* claim they like. "GPT‑4o, policy v3, response hash 0xabc" is one `wallet.signMessage()` call away from being a lie.

So the signature is only worth something if you can answer three questions **without trusting the operator**:

1. **Who holds the signing key?** If a human can read it, they can forge receipts.
2. **What code is doing the signing?** A signature from malicious code is a malicious signature.
3. **How do I know the key belongs to *this* app and not some throwaway?**

A normal server (AWS, a VPS, even "we pinky-swear we use HSMs") cannot answer these to a skeptical outsider. The operator always has a path to the key and the code. **This is exactly the gap a TEE closes, and it's the whole reason EigenCompute is here:**

| Question | How EigenCompute answers it |
|---|---|
| Who holds the key? | The mnemonic is **derived by the KMS and only released *inside* a TEE whose measurement matches an approved image**. The operator never sees it. There is no `console.log(mnemonic)` that helps you — it doesn't decrypt outside the enclave. |
| What code signed? | The image is **measured into the TDX RTMRs at boot** and the digest is published on the [Verifiability Dashboard](https://verify-sepolia.eigencloud.xyz/). You can diff the digest against the image built from *this* source. Different code → different measurement → visible. |
| Whose key is it? | The signing key derives to an on-chain **Derived Address** bound to the app's identity. `/pubkey` must equal that address, or the app is lying about who it is. |

Put together: **a valid signature on a receipt means "this specific, publicly-measured code, running in a genuine Intel TDX enclave, using a key no human can extract, made this decision."** That is a fundamentally different claim from "the operator says so" — and there is no way to manufacture it on ordinary infrastructure. Strip the TEE out and the receipts become theater: I could generate every one of them from a laptop with a for-loop.

That's the story. The router is the interesting *application*; the TEE is what turns its signatures from decoration into evidence.

## Architecture: two enclaves, two keys, one chain of custody

The trick to attesting *inference* and not just the *decision* is to not let the router run the model. It doesn't. Each model lives in its **own** enclave (a "worker") with its **own** key, and signs its own output. The router (the "conductor") verifies those worker signatures and folds them into the receipt it signs.

```
                    signs the routing receipt with its enclave key
   client ─▶  CONDUCTOR  ───────────────────────────────────────▶  signed receipt
   (you)         │  1. extract signals (len, lang, complexity)        + worker_attestations[]
                 │  2. decide(policy)  → looper + candidate models
                 │  3. call worker(s), VERIFY each signature
                 ▼
             WORKER(s)  ── one model per enclave, its OWN key
                          runs inference, signs {model_id, input_hash, response_hash}
```

The receipt's `response_hash` equals the worker attestation's `response_hash` (`0x5356a5a2…` in the live example). **That shared hash is the seam that binds "the router chose X" to "the enclave running X produced exactly this output."** Tamper with either side and the seam — and the enclosing signature — breaks.

Chain of custody: **you → conductor receipt (conductor key) → worker attestations (worker keys)**, every link independently recoverable from public `/pubkey` endpoints.

## What's live right now

| Service | App ID | Enclave key = on-chain Derived Address | Dashboard |
|---|---|---|---|
| **Conductor** | `0x7F2EC821fbD68e8A20C7C01a9498b6C70bC9c896` | `0x47121Ad5…4864445` | [verify](https://verify-sepolia.eigencloud.xyz/app/0x7F2EC821fbD68e8A20C7C01a9498b6C70bC9c896) |
| **Worker** (real OpenRouter inference, sealed API key) | `0xdb06a76f914513519217DCb4c7c6E1160238f600` | `0x2f116ff2…F7F32812` | [verify](https://verify-sepolia.eigencloud.xyz/app/0xdb06a76f914513519217DCb4c7c6E1160238f600) |

Deployed on `g1-standard-4t` (Intel TDX). Image: `zeeshan8281/attested-router:v2` on Docker Hub.

## Verify it yourself

You trust only `ethers` and the apps' public `/pubkey`. Nothing else.

```bash
git clone https://github.com/zeeshan8281/attested-vllm-router && cd attested-vllm-router
npm install                              # for ethers

C=http://34.143.160.145:8080             # conductor (see note on IP below)

# 1) Who is signing? Compare to the Derived Addresses on the dashboard above.
curl -s $C/pubkey                        # -> 0x47121Ad5…
curl -s http://34.12.63.128:8080/pubkey  # worker -> 0x2f116ff2…

# 2) Make YOUR OWN request — real inference, freshly signed.
curl -s -X POST $C/v1/route -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"say hi in one word"}]}' > mine.json
TASK=$(node -e 'console.log(require("./mine.json").task_id)')

# 3) Independent verifier: recovers conductor + every worker signer.
node scripts/verify.mjs $C $TASK
#  conductor: ✓ 0x47121Ad5…  (matches /pubkey)
#  worker   : ✓ openai/gpt-4o-mini signed by 0x2f116ff2…
#  ✓ CHAIN VERIFIED — decision + inference, all enclave-signed
```

Prove the signature is load-bearing — flip one character and watch it break:

```bash
curl -s $C/trace/$TASK > t.json
node -e '
const {verifyMessage}=require("ethers"); const d=require("./t.json");
const ok  = verifyMessage(d.canonical, d.signature);
const bad = verifyMessage(d.canonical.replace(/gpt-4o/,"evil-model"), d.signature);
console.log("intact  ->", ok.toLowerCase()===d.signer_address.toLowerCase() ? "✓ matches signer" : "✗");
console.log("tampered->", bad.toLowerCase()!==d.signer_address.toLowerCase() ? "✓ rejected (recovers a different address)" : "✗ LEAK");
'
```

> **Note:** an app's public IP can change on restart. Re-resolve with
> `ecloud compute app info 0x7F2EC821fbD68e8A20C7C01a9498b6C70bC9c896` (look at the IP line), or read it off the dashboard.

## Endpoints

**Conductor** — `POST /v1/route` (main) · `GET /trace/:id` · `GET /trace` · `GET /recipe` · `GET /pubkey` · `GET /health`
**Worker** — `POST /infer` (returns a signed attestation) · `GET /pubkey` · `GET /health`

`POST /v1/route` is OpenAI-compatible-ish: `{ "messages": [{ "role": "user", "content": "…" }], "max_tokens": 512 }`.

## Routing internals

**Signals** (`src/router/signals.ts`) — deterministic, no network: `token_estimate` (chars/4), `detected_lang` (script heuristic), `complexity_band` (rule-based). Same input → same signals, or the receipt wouldn't be reproducible.

**Policy** (`src/router/policy.ts`) — a pure function of `signals + recipe`. The recipe is public (`ROUTING_RECIPE_PUBLIC`) and `policy_hash = keccak256(canonical({bands, params}))` is stamped into every receipt, so the decision is checkable against `GET /recipe`.

**Loopers** (`src/router/loopers.ts`) — all real, no stubs:

| looper | behavior |
|---|---|
| `single` | route to the first candidate |
| `confidence` | call cheapest; if confidence (geometric-mean token probability from **real logprobs**) < threshold, escalate to the next; records every attempt |
| `ratings` | fan out to all candidates in parallel; pick the highest-confidence verified answer |
| `remom` | repeated Mixture-of-Agents: each round all candidates propose, an aggregator synthesizes; repeat `remom_rounds` |

Every model call — including each escalation and every fan-out branch — produces its own signed worker attestation in the receipt.

## Run / deploy your own

```bash
npm install
npm test          # 13 tests: canonicalization, conductor round-trip, policy determinism,
                  # worker-attestation verify, model-swap / forgery / tamper rejection
npm run build     # dist/index.js = conductor, dist/worker/index.js = worker (one image, ROLE_PUBLIC picks)
```

Deploy is two EigenCompute apps (one worker per model, then the conductor pointing at it). Full walkthrough in [`DEPLOY.md`](./DEPLOY.md). The short version:

```bash
docker build --platform linux/amd64 -t <you>/attested-router:v1 . && docker push <you>/attested-router:v1
# worker  (sealed MODEL_API_KEY, real inference)
ecloud compute app deploy --name attested-worker --image-ref <you>/attested-router:v1 \
  --env-file worker.env --instance-type g1-standard-4t --force
# conductor (WORKERS_PUBLIC points at the worker; JSON env base64-encoded — see DEPLOY.md)
ecloud compute app deploy --name attested-router --image-ref <you>/attested-router:v1 \
  --env-file conductor.env --instance-type g1-standard-4t --force
```

`MNEMONIC` is **not** something you set — EigenCompute's KMS injects a per-app, enclave-bound key at boot. That's the point.

## Honest boundaries

I'd rather you trust this *less* and check it *more*, so here's exactly what it does and does not prove:

- **The routing decision is fully attested.** Which model, under which policy, with which signals — signed by measured enclave code. This is airtight.
- **The inference is attested to the enclave, not (yet) to the weights.** The worker here uses an `openai` backend: it calls OpenRouter *from inside its enclave* and signs the result. So a worker attestation means *"this measured enclave relayed this exact output for this model_id"* — strictly stronger than an unattested gateway, but weaker than *"this enclave computed it on-device from attested GPT‑4o weights."* Closing that last gap needs the model running **inside** the TEE, which needs a **GPU-capable TEE tier**. The code path is identical (`WORKER_BACKEND=local`); only the hardware is missing. When those tiers are available, nothing in the protocol changes — you just point the worker at local weights.
- **Availability/liveness is not attested.** Receipts prove what happened when a request succeeded; they don't promise the service stays up.

The point of naming these is that the receipt never over-claims: the boundary is in the code (`worker_attestations[].verified`) and stated in `/recipe`, not buried in a pitch.

## Layout

```
src/
  main.ts            role switch (conductor | worker) via ROLE_PUBLIC
  index.ts           conductor: express bootstrap
  crypto.ts          canonicalize (stable stringify) + keccak + wallet
  signer.ts          conductor enclave key
  config.ts          env + public policy assembly + policy_hash
  attestation.ts     the trust contracts shared by both roles
  receipt.ts         routing receipt: build → canonicalize → sign → store
  store.ts           in-memory ring buffer (cap 10k)
  router/
    signals.ts       deterministic signal extraction
    policy.ts        pure decide(signals) -> {looper, candidates}
    loopers.ts       single | confidence | ratings | remom
    workers.ts       call a worker, VERIFY its attestation, fold into receipt
  worker/
    index.ts         worker: /infer, signs every output
    backend.ts       openai (real inference) | echo (deterministic dev/CI)
    config.ts        worker env
scripts/verify.mjs   standalone external chain verifier
test/                13 tests
```

---

Built with the EigenCompute attested-api pattern. The router is a real semantic router; the receipts are the product; the TEE is what makes the receipts mean something.

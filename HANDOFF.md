# HANDOFF — AutoRouter Arena (v1 live + v2 pivot in progress)

_Last updated: 2026-07-16. Read this first when picking work back up._

## TL;DR

- **v1 (`main`)** — attested multi-stage LLM-routing grader. **Live on sepolia + Vercel.** Done, shippable, untouched.
- **v2 (`v2` branch)** — the "harness-efficiency competition" pivot. **In progress.** Anti-abuse + scoring core + CI skeleton built; benchmark run is blocked on tooling/keys.
- Two things still owed on v1: **rotate the OpenRouter key** (was pasted in plaintext), optional COMPETITION/SKILL "identity" note.

---

## Repos & where things live

| Path | GitHub | Role |
|---|---|---|
| `/Users/zeeshan/arena-router` | `zeeshan8281/arena-router` | **ACTIVE.** v1 on `main`, pivot on `v2`. Vercel UI deploys from here. |
| `/Users/zeeshan/attested-router` | `zeeshan8281/attested-vllm-router` | Source we ported v1 from. **Deprecated** — don't edit; `arena-router` is the single source of truth. |

---

## v1 — attested multi-stage grader (`main`, LIVE)

**What it is:** participants submit a pure `decide(prompt, models)` policy; the grader (in an EigenCompute TEE) routes each **stage** of a multi-stage SWE task, calls the chosen models **live via OpenRouter**, chains outputs, an LLM judge (`gpt-4o-mini`) grades the final transcript, and the enclave **signs** the score. Leaderboard name = **verified GitHub login only**.

**Live infra:**
- Grader (sepolia, Intel TDX): `http://34.7.20.95:8080` · app `0x25e745d0e7a7510d79184a07E02AcEC3eEE57F17` · grader key `0x0660177dC656F04EE0c37c98A467a64747D3b573` · image `zeeshan8281/attested-router:grader-v4`.
- Dashboard: https://verify-sepolia.eigencloud.xyz/app/0x25e745d0e7a7510d79184a07E02AcEC3eEE57F17
- UI: https://arena-router-ui.vercel.app (Vercel project `arena-router-ui`, **git auto-deploy ON**: repo `arena-router`, branch `main`, **root dir `ui`**).
- **Terminated / dead:** old grader `34.136.240.56` (sepolia), wrong-network grader `34.187.54.54` (mainnet-alpha). Don't reference these.

**Sealed secrets (KMS, only in-enclave):** `MNEMONIC` (KMS-injected signer), `OPENROUTER_API_KEY`, `HIDDEN_SET_B64`, plus public-ish env `CATALOG_PUBLIC`, `GRADER_MODEL=openai/gpt-4o-mini`, `STARTER_POLICY_HASHES`, `GITHUB_AUTH=on`.

**Hidden set (v1):** 3 multi-stage SWE tasks / 9 stages (rate limiter, CSV parser, bugfix). Generate with `node scripts/gen-hiddenset.mjs` → `arena/hidden/hiddenset.json` (**gitignored** — answer key). It prints `HIDDEN_SET_B64` for the enclave env.

**Enforcement live & verified:** anti-copy (reject unmodified starter), GitHub-token identity (arbitrary name / bogus token → 401), signature recovers to grader key.

### Redeploy v1 (recipe)
```sh
cd /Users/zeeshan/arena-router
docker build --platform linux/amd64 -t zeeshan8281/attested-router:grader-vN .
docker push zeeshan8281/attested-router:grader-vN
# env-file: ROLE_PUBLIC=grader, GRADER_MODEL, BENCHMARK_NAME_PUBLIC, GITHUB_AUTH=on,
#   CATALOG_PUBLIC=$(base64 config), OPENROUTER_API_KEY, HIDDEN_SET_B64=$(base64 hiddenset),
#   STARTER_POLICY_HASHES=<comma hashes from gen>
mv Dockerfile /tmp/D.bak   # avoid interactive prompt
ecloud compute app upgrade 0x25e745d0e7a7510d79184a07E02AcEC3eEE57F17 \
  --image-ref zeeshan8281/attested-router:grader-vN --environment sepolia \
  --env-file /tmp/grader.env --non-interactive --force
mv /tmp/D.bak Dockerfile
```
Notes: **must** be `--environment sepolia` (default is mainnet-alpha = wrong). CLI needs `--force` (piped y/n doesn't work). "Running" ≠ serving — poll `http://IP:8080/health`. Board is in-memory → resets on upgrade.

### Owed on v1
- **Rotate `OPENROUTER_API_KEY`** (was in plaintext chat). New key → re-run the upgrade recipe with it in the env-file. Nothing in git to change.

---

## v2 — harness-efficiency competition (`v2` branch, IN PROGRESS)

**The pivot:** make an AI coding agent as cheap as possible without making it dumber. Same harness (vanilla `pi` CLI + OpenRouter, add plugins/skills/config only). Benchmark = **Terminal-Bench 2.x** (89 tasks, Z.ai Verified/2.1 images). Baseline = plain GLM 5.2. Match/beat its pass rate, then **lowest OpenRouter billed spend wins** — **score = the generation ledger**. Flow: local iterate → PR → CI smoke gate → org-funded full run → leaderboard.

Planning docs: **PR #2** (`docs/benchmark-cost-survey.md`, `smoke-subset.md`, `ci-anti-abuse.md`) by `mcclurejt`. Read them — the design is detailed and locked in places.

### Built on `v2` so far
- **`competition/README.md`** — v2 overview + status.
- **`competition/anti-abuse/`** (ci-anti-abuse §3a) — DONE, 9 tests pass:
  - `tripwire.mjs` + `task-ids.txt` (real 89 IDs from `laude-institute/terminal-bench-2`) + `solution-strings.txt` (seeded empty) — static diff scan, boundary-matched, triage.
  - `judge.mjs` + `judge-prompt.md` (versioned) — LLM judge → clean/suspicious/violation; ready to run with a key.
- **`competition/scoring/`** (ci-anti-abuse §1,§3b + smoke §5) — pure logic, 7 tests pass:
  - `models.json` — 8-model allowlist (**slugs UNVERIFIED** except `z-ai/glm-5.2` — confirm vs openrouter.ai/models).
  - `integrity.mjs` — allowlist / BYOK=0 / :free-ban / token-anomaly checks (void vs review).
  - `score.mjs` — median-of-3 aggregate, smoke gate (pass-count only), leaderboard rank (qualified-by-baseline then cheapest).
  - `openrouter.mjs` — Provisioning client: `mintKey`/`keyStatus`/`deleteKey`/`generation`/`withCappedKey`. **Response shapes need live verification.**
- **`.github/workflows/`**:
  - `guard.yml` — **functional**: tripwire on every PR (+ judge if `OPENROUTER_JUDGE_KEY` secret set).
  - `smoke.yml` — **skeleton** (workflow_dispatch): mint $1.50 key → harbor 16 median-of-3 → score → delete. References `competition/ci/run-benchmark.mjs` (**NOT YET BUILT**).

Run all v2 tests: `node --test competition/**/*.test.mjs`

### Next (build order)
1. **`competition/ci/run-benchmark.mjs`** — orchestrator: `withCappedKey` → run harbor → parse pass count + generation ids → `aggregate`/`checkIntegrity`/`smokeGate` → JSON out. Harbor spawn + output parsing is the seam (harbor not installed yet).
2. **`.github/workflows/full.yml`** — on smoke pass → $10 key → harbor 89 → ledger → leaderboard. (Full-run trigger is an OPEN item: auto vs `run-full-bench` maintainer label — recommend the label.)
3. **Participant kit** — vanilla-`pi` harness layout + plugin/skill/config contract + single smoke-run wrapper (harbor command is in smoke-subset §4). Needs `pi`/`harbor` interface knowledge.
4. **Repo restructure** — quarantine v1 into `legacy/` once v2 solidifies (do NOT do prematurely; coordinate with `mcclurejt`).

### BLOCKED (can't do locally yet)
- `harbor`, `pi`, `terminal-bench` **not installed**; no OpenRouter key in env → **baseline probe + any real benchmark run blocked**. Everything above is plumbing built against docs + unit-tested.
- Unblock levers: (a) an **OpenRouter management key** (even capped throwaway) makes the scoring/ledger core live-testable; (b) `pi`/`harbor` install + docs make the kit + runner real.

### OPEN design questions (from PR #2 — my recommendations)
- **Full-run trigger:** don't auto-run on smoke pass (money leak); gate behind a `run-full-bench` maintainer label.
- **Anti-gaming:** TB is public-with-solutions → the LLM judge is heuristic. The structural fix is a **held-out private task set** for the scoring run (the one v1 idea worth carrying over). Iterate public, score private.
- **Smoke→full predictiveness:** make the 16 smoke tasks a **stratified** sample of the 89 (they mostly are — verify rank correlation post-probe).
- **Harness-Bench as scored tier:** it's partly LLM-judged → contradicts "the ledger is the score". Keep exploratory/off-leaderboard.
- **Micro-tier:** add a 4-task median-of-1 (~$1–2) local loop; $10–25/iteration kills velocity.
- **Repo migration:** quarantine v1 → `legacy/`, keep leaderboard + GitHub identity; attestation/TEE grader is **superseded** (TB deterministic tests + OpenRouter ledger need no enclave).

---

## Env / tooling facts
- Dev env has: `node 22`, `python 3.9`, `uv`, `docker 29`, `gh`, `ecloud` (v1.0.0), `vercel` (authed as `zeeshan8281`).
- Missing: `harbor`, `pi`, `terminal-bench`, any OpenRouter key.
- Vercel token for API (root-dir/deploy ops): `~/Library/Application Support/com.vercel.cli/auth.json`. Project `prj_3GRBgRYPCbQQMwooOjfsLYOcoxNY`, team `team_d2iNytjMuKmgbHLvTAewMSR4`.
- Diagrams: `docs/arena-architecture.excalidraw.json` + `docs/arena-routing.excalidraw.json` (regen via `scripts/gen-arena-*.py`) — these describe **v1**.

# AutoRouter Arena — v2: harness-efficiency competition

> **You are on the `v2` branch (work in progress).** The pivot. v1 — the attested
> multi-stage LLM-routing grader (live on Sepolia + Vercel) — lives on **`main`**;
> nothing here touches it.

## The pivot

Make an AI coding agent **as cheap as possible without making it dumber.**

- **Same harness for everyone:** a vanilla [`pi`](https://github.com/earendil-works/pi)
  CLI on OpenRouter. You may add plugins, skills, agent profiles, config — anything
  *except* modifying pi's source.
- **Benchmark:** [Terminal-Bench 2.x](https://github.com/laude-institute/terminal-bench-2)
  (89 terminal-native tasks), run under [Harbor](https://www.harborframework.com).
- **Baseline:** vanilla pi + `z-ai/glm-5.2`. Match/beat its pass count, then
  **lowest inference spend wins.**
- **Score = the ledger.** Actual billed dollars from OpenRouter's generation records —
  caching and every secondary effect included. No modeling, no self-reporting.

```
iterate locally (own key, 16-task smoke set, kit CLI)
        │  PR into submissions/<github-login>/
        ▼
static checks + tripwire + LLM judge (Sonnet 4.6, blocks on suspicious+)
        ▼ clean
smoke gate  — capped key → median-of-3 × 16 tasks → ledger → pass count ≥ gate
        ▼ pass (auto)
full run    — capped key → 1 × 89 tasks → ledger → validity checks → results JSON
        ▼
leaderboard (static JSON) → web UI
```

## Where the design lives

- **[`docs/implementation-spec.md`](./docs/implementation-spec.md)** — authoritative build
  spec: decision ledger (D1–D23), repo layout, work packages (WP1–12).
- Companions: [`benchmark-cost-survey.md`](./docs/benchmark-cost-survey.md),
  [`smoke-subset.md`](./docs/smoke-subset.md), [`ci-anti-abuse.md`](./docs/ci-anti-abuse.md).
- **[`competition/`](./competition)** — anti-abuse (tripwire + judge) and the scoring/ledger
  prototype (Node; being consolidated into `pipeline/` per D19).

## Build status

| Piece | State |
|---|---|
| **`agent/`** — pi↔Harbor adapter (WP2) | ✅ built + tested; D20 install path validated live, key-free ([agent/README](./agent/README.md)) |
| **`vendor/pi/`** — vendored pi (WP1) | ✅ `@earendil-works/pi-coding-agent@0.80.9`, checksum in `competition.toml` |
| **`competition/anti-abuse/`** — tripwire + judge | ✅ built; judge needs re-pointing to Anthropic (D13) |
| **`competition/scoring/`** — ledger/integrity/score | 🟡 prototype; live-validation blocked on an OpenRouter key |
| Repo pivot (teardown v1, stand up `pipeline/`) | ⬜ pending |
| CI workflows, self-hosted runner + egress (WP6/7) | ⬜ pending |
| Baseline probe → freeze gate numbers (WP11) | ⛔ blocked on an OpenRouter key |

Local harness setup (harbor + pi, the version-pin gotcha, what's validated vs blocked):
**[`competition/LOCAL_SETUP.md`](./competition/LOCAL_SETUP.md)**.

## Run the harness locally

Full recipe in [`competition/LOCAL_SETUP.md`](./competition/LOCAL_SETUP.md). The key-free
end-to-end check:

```bash
source ~/workspaces/pi-terminal-bench/.venv/bin/activate    # harbor 0.1.18 pinned
harbor run -d terminal-bench@2.0 -t fix-git -a oracle -n 1  # reward 1.0, no key needed
```

# Secrets — what to add and where

Two homes: the **GitHub `eval-runner` environment** (for CI, spec §3) and a local
**`.env`** (for running the baseline probe / `arena smoke` locally). Real values never
go in the repo — `.env` is gitignored; `.env.example` is the template.

## GitHub `eval-runner` environment (CI)
Add at: **repo → Settings → Environments → `eval-runner` → Add secret** (already created).

| Secret | Purpose | Who needs it |
|--------|---------|--------------|
| `OPENROUTER_MANAGEMENT_KEY` | mint capped per-run keys + pull the ledger (§6.1) | smoke.yml, full-run.yml |
| `ANTHROPIC_API_KEY` | the judge, Claude Sonnet 4.6 (§5.2, D13) | checks.yml |
| `RESULTS_BOT_TOKEN` | fine-grained PAT, contents:write, to commit `results/` (§3) | full-run.yml, leaderboard.yml |
| `RESULTS_SIGNING_KEY` | optional — minisign secret to sign run files (§7.1) | full-run.yml |

> The account behind `OPENROUTER_MANAGEMENT_KEY` needs a **credit balance** — the probe
> and real runs spend actual dollars through the keys it mints.

## Local `.env` (baseline probe + local smoke)
`cp .env.example .env`, fill in, then use Node's loader:
```bash
node --env-file=.env competition/runner.mjs --type baseline --author _baseline   # the probe
node --env-file=.env kit/arena.mjs smoke --trials 1                              # local smoke
```
Local runs need: `OPENROUTER_MANAGEMENT_KEY` (probe) and/or `OPENROUTER_API_KEY` (smoke).

## Hetzner box (WP7) — not a GitHub secret
The box is provisioned over SSH (`infra/runner-setup.md`); it registers itself as the
`eval` self-hosted runner using `GH_RUNNER_TOKEN`. The OpenRouter/Anthropic keys are
injected into jobs from the `eval-runner` environment — they are **never stored on the box**.
Add to `.env` for provisioning convenience: `EVAL_BOX_SSH`, `GH_RUNNER_TOKEN`.

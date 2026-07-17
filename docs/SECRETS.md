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

> The account behind `OPENROUTER_MANAGEMENT_KEY` needs a **credit balance** — the probe
> and real runs spend actual dollars through the keys it mints.

**`RESULTS_BOT_TOKEN` may lag the others.** full-run.yml degrades gracefully while
it is unset: the commit-to-main step skips, the run JSON is preserved as a
workflow artifact (`results-pr<N>`, 90-day retention), and the leaderboard
dispatch is suppressed. Set the PAT later and the normal commit path takes over.

**Verify caps before any real run.** Once `OPENROUTER_MANAGEMENT_KEY` is set
locally (`.env`), run `node --env-file=.env scripts/verify-openrouter.mjs` — it
burns down the VERIFY markers in `scoring/openrouter.mjs` against the live API
and proves the per-key credit cap is enforced server-side. Worst-case spend
≈ $0.05. Do not dispatch smoke/full/baseline until it passes.

## Interim: GitHub-hosted eval runs (`EVAL_RUNS_ON` repo variable)

Until the eval box registers, smoke.yml / full-run.yml default to
`ubuntu-latest`. This mode has **no egress lockdown** (no squid, no internal-only
network), so it is only acceptable maintainer-gated:

1. **Protect the `eval-runner` environment**: repo → Settings → Environments →
   `eval-runner` → **Required reviewers** → add the maintainer. Every job that
   can see the secrets then waits for an explicit approval click.
   *Side effect:* checks.yml's `judge` job uses the same environment for
   `ANTHROPIC_API_KEY`, so each PR push's judge also waits for approval. That
   is correct for the maintainer-only interim; when opening to the public,
   either lift the rule (box mode) or move the judge key to its own
   unprotected environment.
2. Spend stays bounded regardless: every run mints a key hard-capped at
   $1.50 (smoke) / $10 (full/baseline), enforced server-side by OpenRouter.

When the box is up, set the repo **variable** `EVAL_RUNS_ON` to
`["self-hosted","eval"]` (Settings → Secrets and variables → Actions →
Variables) — no commit needed to flip.

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

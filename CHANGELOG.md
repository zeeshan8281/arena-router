# v2 changelog — build progress vs the spec

Tracks implementation of the harness-efficiency competition against the work packages
in [`docs/implementation-spec.md`](./docs/implementation-spec.md) §10. Legend:
**✅ done** · **🟡 partial** · **⛔ blocked** (needs a key/infra) · **⬜ not started**.

_Last updated: 2026-07-17._

## Score: ~6 of 12 work packages substantially built; 2 blocked on a key, rest pending the repo pivot.

| WP | Package | Status | What's in the tree | What's left |
|----|---------|--------|--------------------|-------------|
| 1 | Repo pivot & scaffolding | 🟡 | `vendor/pi/pi.tgz` vendored + checksummed; `competition.toml` (full §8); `config.mjs` loader + TBD-sentinel guard | v1 teardown (router/grader) not done — building alongside instead of pivoting; `pipeline/` uses `competition/*.mjs`, not a `pipeline/src/*.ts` package |
| 2 | pi ↔ Harbor adapter | ✅ | `agent/pi_agent.py` (D20 vendored install + checksum + echo mode); 6 offline tests; oracle + echo-install validated live, key-free | real model call unvalidated (needs a key) |
| 3 | Keys, ledger, budget | 🟡 | `scoring/openrouter.mjs` (mint/status/delete/generation/withCappedKey), `integrity.mjs` (BYOK/allowlist/:free/anomaly), `budget.mjs` (monthly cap) — all unit-tested | Provisioning API **response shapes UNVERIFIED** — needs a real management key to confirm (marked in code) |
| 4 | Static checks + tripwire | ✅ | `anti-abuse/checks.mjs` (path-containment incl. D20 vendor guard, manifest, size caps) + `tripwire.mjs` (89 task IDs, base64/hex) — tested | `solution-strings.txt` seeded empty; enrich from `solution/` dirs |
| 5 | LLM judge | 🟡 | `anti-abuse/judge.mjs` → Anthropic Sonnet 4.6 (D13), `callJudge`/`parseVerdict`/`isBlocked` (D12) tested; prompt versioned | live call needs `ANTHROPIC_API_KEY`; 4-way surfacing (check run/sticky comment/label/judge-log) + SHA verdict cache + override label live only in `checks.yml`, unproven |
| 6 | CI workflows | 🟡 | `.github/workflows/{checks,smoke,full-run,leaderboard}.yml` per §5–§7 | can't run here; depends on `runner.mjs` (below) + secrets + self-hosted runner |
| 7 | Eval box + egress | 🟡 | `infra/` (squid allowlist, internal-network compose, runner-setup runbook) | not provisioned; empirical 89-task allowlist derivation pending (log-only run) |
| 8 | Results + leaderboard | ✅ | `scoring/results.mjs` (run-result assembly, leaderboard gen, optional minisign) + `harbor-results.mjs` (harbor→scoring parser, tested on real output) | JSON-Schema export not emitted; signing is a stub (off unless a signer is configured) |
| 9 | Web UI rewire | ⬜ | — | needs the repo pivot; carry over OAuth, point at `results/` JSON |
| 10 | Participant kit | 🟡 | `kit/arena.mjs` — `init`/`check`/`verify-pi`/`report` built + tested; `kit/skill/SKILL.md`, `submissions/_template/` | `arena smoke` is a stub (needs a key to wire the local Harbor run) |
| 11 | Baseline probe + config freeze | ⛔ | probe path exists via `runner.mjs` + `config.assertRunnable` exemption | needs an OpenRouter key; fills `smoke.gate` + `full.eligibility_bar` (the `-1` sentinels) |
| 12 | Improvement-loop skill | ✅ | `kit/skill/SKILL.md` — minimal one-pager (revised D22) | — |

**Runner (§6.1, the orchestrator WP6 depends on):** ✅ built + tested — `competition/runner.mjs`
wires config gate → budget → mint capped key → Harbor trials → `parseHarborResult` → ledger
cost deltas → integrity → results JSON. 5 orchestration tests (all seams mocked). Live run
needs a key; per-generation allowlist enforcement (transcript gen-IDs) is a marked follow-up.

## Blocked on you (not on code)
- **OpenRouter management key** → unblocks WP3 live-validation, WP11 baseline probe, real runs.
- **Anthropic API key** → live judge (WP5).
- **Repo-pivot go-ahead** → WP1 teardown, WP9 web, and moving `competition/*.mjs` into `pipeline/`.

## Test status
`node --test $(find competition kit -name '*.test.mjs')` → 46 pass · `pytest agent/` → 6 pass.

## Commit trail (v2 branch)
- WP6 runner + WP10 kit CLI (init/check/verify-pi/report)
- `dce005e` WP5 judge → Anthropic (D13/D12)
- `e15b399` pipeline core (config/budget/checks/results) + CI/infra/kit scaffolds
- `c90e264` harbor result.json parser (harbor→scoring seam)
- `c091a1b` WP1 vendor pi + validate D20 install path (key-free)
- `efd0bf6` WP2 pi↔Harbor adapter + local setup notes

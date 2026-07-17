# v2 changelog — build progress vs the spec

Tracks implementation of the harness-efficiency competition against the work packages
in [`docs/implementation-spec.md`](./docs/implementation-spec.md) §10. Legend:
**✅ done** · **🟡 partial** · **⛔ blocked** (needs a key/infra) · **⬜ not started**.

_Last updated: 2026-07-17._

## Score: 12/12 work packages implemented as far as code allows; v1 quarantined into `legacy/`. What remains is pure execution, not construction — live runs (need an OpenRouter + Anthropic key) and eval-box provisioning (need hardware). All buildable logic is written + tested (61 node + 6 pytest).

| WP | Package | Status | What's in the tree | What's left |
|----|---------|--------|--------------------|-------------|
| 1 | Repo pivot & scaffolding | ✅ | `vendor/pi/pi.tgz` vendored + checksummed; `competition.toml` (full §8); `config.mjs` loader + TBD-sentinel guard; **v1 quarantined into `legacy/`** (non-destructive per handoff; `main` untouched) | deliberate layout choice: pipeline is `competition/*.mjs` (Node, no build) not `pipeline/src/*.ts` — a lazy deviation from §2, not a gap |
| 2 | pi ↔ Harbor adapter | ✅ | `agent/pi_agent.py` (D20 vendored install + checksum + echo mode); 6 offline tests; oracle + echo-install validated live, key-free | real model call unvalidated (needs a key) |
| 3 | Keys, ledger, budget | 🟡 | `scoring/openrouter.mjs` (mint/status/delete/generation/**keyGenerations**/**selfKeyUsage**/withCappedKey), `integrity.mjs`, `budget.mjs`, `runner.mjs` — unit-tested | runner enforces **per-generation-record** allowlist (§6.1.6); OpenRouter endpoint/field **shapes VERIFY-marked** — need a mgmt key to confirm |
| 4 | Static checks + tripwire | ✅ | `anti-abuse/checks.mjs` (path-containment incl. D20 vendor guard, manifest, size caps) + `tripwire.mjs` (89 task IDs, base64/hex) — tested | `solution-strings.txt` seeded empty; enrich from `solution/` dirs |
| 5 | LLM judge | 🟡 | `anti-abuse/judge.mjs` → Anthropic Sonnet 4.6 (D13); `callJudge`/`isBlocked` (D12); SHA verdict cache + surfacing helpers (`stickyCommentBody`/`judgeLogLine`/`judgeLabel`) all tested; prompt versioned | live model call needs `ANTHROPIC_API_KEY`; helpers are wired into `checks.yml` but that workflow is unrun |
| 6 | CI workflows | 🟡 | `.github/workflows/{checks,smoke,full-run,leaderboard}.yml` per §5–§7 | can't run here; depends on `runner.mjs` (below) + secrets + self-hosted runner |
| 7 | Eval box + egress | 🟡 | `infra/` (squid allowlist, internal-network compose, runner-setup runbook) | not provisioned; empirical 89-task allowlist derivation pending (log-only run) |
| 8 | Results + leaderboard | ✅ | `scoring/results.mjs` + `harbor-results.mjs` (tested on real output) + `results/schema/{run,leaderboard}.schema.json`; `run.json` matches §7.1 exactly (validity fields, `openrouter_key_name`, per-trial tokens/gen-ids); leaderboard CLI verified end-to-end | results unsigned by design — branch protection + CI path gate are the integrity guarantee |
| 9 | Web UI rewire | ✅ | `ui/` v2 React SPA (leaderboard + run-detail reading `results/*.json`, §7.3) — v1 grader/receipts/ethers removed, OAuth kept, typechecks + builds; `web/*.html` static fallback + tested `render.mjs` | not visually verified here (no browser) |
| 10 | Participant kit | ✅ | `kit/arena.mjs` + `kit/smoke.mjs` — `init`/`check`/`verify-pi`/`smoke`/`report` built + tested (injectable spawn, `--out` artifacts, `--tasks`, report deltas); `SKILL.md`, `_template/` | only the Harbor spawn needs a key at runtime |
| 11 | Baseline probe + config freeze | ⛔ | probe path (`runner --type baseline`, cap-exempt) + sentinel guard built; freeze procedure documented (`docs/baseline-probe.md`) | the actual run needs an OpenRouter key — it fills `smoke.gate` + `full.eligibility_bar` (the `-1` sentinels) |
| 12 | Improvement-loop skill | ✅ | `kit/skill/SKILL.md` — minimal one-pager (revised D22) | — |

**Runner (§6.1, the orchestrator WP6 depends on):** ✅ built + tested — `competition/runner.mjs`
wires config gate → budget → mint capped key → Harbor trials → `parseHarborResult` → ledger
cost deltas → integrity → results JSON. 5 orchestration tests (all seams mocked). Live run
needs a key; per-generation allowlist enforcement (transcript gen-IDs) is a marked follow-up.

## Blocked on you (not on code)
- **OPENROUTER_MANAGEMENT_KEY + ANTHROPIC_API_KEY**: set in the `eval-runner` environment (2026-07-16). Next: add the required-reviewer rule on that environment, then run `scripts/verify-openrouter.mjs` (~$0.05) before any real dispatch.
- **RESULTS_BOT_TOKEN** → pending; full-run.yml falls back to a workflow artifact until it lands.
- **Eval box / runner registration token** → interim covered by the `EVAL_RUNS_ON` hosted-runner toggle (maintainer-approved runs only, no egress lockdown).

## Test status
`node --test $(find competition kit web -name '*.test.mjs')` → 61 pass · `pytest agent/` → 6 pass.

## Commit trail (v2 branch)
- fidelity to §6.1/§6.5/§7.1: per-record allowlist, ledger cost for `arena smoke`, `run.json` shape
- WP9 v2 React SPA (ui/ rewired to results/ JSON)
- real `arena smoke`/`report` + enriched tripwire + leaderboard schema
- WP1 quarantine v1 → `legacy/`
- WP9 static views + WP5 judge surfacing/cache + WP11 freeze doc
- WP6 runner + WP10 kit CLI
- `dce005e` WP5 judge → Anthropic (D13/D12)
- `e15b399` pipeline core (config/budget/checks/results) + CI/infra/kit scaffolds
- `c90e264` harbor result.json parser (harbor→scoring seam)
- `c091a1b` WP1 vendor pi + validate D20 install path (key-free)
- `efd0bf6` WP2 pi↔Harbor adapter + local setup notes

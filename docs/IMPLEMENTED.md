# What is implemented (vs the build spec)

One caveat first: this was built against the **revised** decisions the maintainer committed
(at `dac16fef`), which changed a few things — most notably **D19 (Node/TS, not Python)** and
**D22 (minimal skill, not budgeted-autonomy)**. So where the original spec text says
Python/`pipeline/arena_pipeline/*.py`, the real implementation is Node `.mjs` under
`competition/`. Same functions, different language/paths. Flagged below.

## WP-by-WP (§10)

| WP | Status | Where it lives | Note vs the spec |
|----|--------|----------------|-------------------|
| 1 Repo pivot & scaffolding | ✅ | `vendor/pi/pi.tgz`, `competition.toml` (§8), `config.mjs` | v1 **quarantined to `legacy/`** (your call), not deleted; layout is `competition/*.mjs`, not `pipeline/` |
| 2 pi↔Harbor adapter | ✅ | `agent/pi_agent.py` | the one Python file (Harbor forces it); validated live key-free (oracle + vendored install) |
| 3 Keys, ledger, budget | 🟡 | `scoring/openrouter.mjs`, `integrity.mjs`, `budget.mjs` | built + unit-tested; Provisioning **response shapes unverified** (needs a mgmt key) |
| 4 Static checks + tripwire | ✅ | `anti-abuse/checks.mjs`, `tripwire.mjs` | path/manifest/size/tripwire; `solution-strings.txt` seeded empty |
| 5 LLM judge | 🟡 | `anti-abuse/judge.mjs` | Anthropic Sonnet 4.6, D12 gating, SHA cache + all 4 surfacing helpers tested; **live call needs `ANTHROPIC_API_KEY`** |
| 6 CI workflows | 🟡 | `.github/workflows/{checks,smoke,full-run,leaderboard}.yml` | written per §5–§7; **unrun** (need runner + secrets) |
| 7 Eval box + egress | 🟡 | `infra/{squid,docker-compose,runner-setup}` | written; **needs hardware** to provision + derive the real allowlist |
| 8 Results + leaderboard | ✅ | `scoring/results.mjs`, `harbor-results.mjs`, `results/schema/run.schema.json` | leaderboard CLI verified end-to-end; **minisign signing is a stub** |
| 9 Web UI rewire | 🟡 | `web/{leaderboard,run}.html`, `render.mjs` | static views reading `results/*.json`, tested; built **additively** (v1 `ui/` kept, not folded/OAuth-wired) |
| 10 Participant kit | 🟡 | `kit/arena.mjs` | `init`/`check`/`verify-pi`/`report` built + tested; **`arena smoke` stubbed** (needs a key) |
| 11 Baseline probe + freeze | ⛔ | `runner --type baseline` + `docs/baseline-probe.md` | code path + doc done; **the run needs a key** (fills the two `-1` sentinels) |
| 12 Improvement-loop skill | ✅* | `kit/skill/SKILL.md` | *built as the **revised** one-pager (D22-minimal); **not** the R1–R6 budgeted-autonomy version in the original text |

Plus the runner (`competition/runner.mjs`) — the §6.1 orchestrator, built + tested with mocked seams.

## Deliberate deviations from the pre-revision spec
- **D19**: Node `.mjs`, not Python `pipeline/arena_pipeline/`. Only `agent/pi_agent.py` is Python (Harbor forces it).
- **§6.6 skill**: minimal one-pager, not R1–R6 autonomy — per the maintainer's revised D22.
- **judge prompt**: `competition/anti-abuse/judge-prompt.md`, not `judge/prompts/v1.md`.
- **Teardown**: quarantined to `legacy/`, not deleted.

## Genuinely not implemented (execution, not code — all externally blocked)
- Live Provisioning-shape verify (WP3), live judge (WP5), `arena smoke` (WP10), baseline probe + config freeze (WP11) → **need an OpenRouter mgmt key + an Anthropic key**.
- Eval-box provisioning + empirical egress allowlist (WP7) → **needs the bare-metal box**.

Everything that is code-and-docs is written, tested (54 node + 6 pytest green), committed, and
pushed to `origin/v2`. What's left can't be turned into code — it needs the two keys and the box.

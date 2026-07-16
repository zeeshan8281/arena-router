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
| 3 Keys, ledger, budget | 🟡 | `scoring/openrouter.mjs`, `integrity.mjs`, `budget.mjs`, `runner.mjs` | built + unit-tested; runner pulls the key's **generation records** (`keyGenerations`) and checks **every record's** model vs the allowlist (§6.1.6). OpenRouter endpoint/field **shapes `VERIFY`-marked** — need a mgmt key to confirm |
| 4 Static checks + tripwire | ✅ | `anti-abuse/checks.mjs`, `tripwire.mjs`, `solution-strings.txt` | path/manifest/size/tripwire; solution-strings curated from real TB-2 solution dirs (9 verified high-signal answers) |
| 5 LLM judge | 🟡 | `anti-abuse/judge.mjs` | Anthropic Sonnet 4.6, D12 gating, SHA cache + all 4 surfacing helpers tested; **live call needs `ANTHROPIC_API_KEY`** |
| 6 CI workflows | 🟡 | `.github/workflows/{checks,smoke,full-run,leaderboard}.yml` | written per §5–§7; **unrun** (need runner + secrets) |
| 7 Eval box + egress | 🟡 | `infra/{squid,docker-compose,runner-setup}` | written; **needs hardware** to provision + derive the real allowlist |
| 8 Results + leaderboard | ✅ | `scoring/results.mjs`, `harbor-results.mjs`, `results/schema/{run,leaderboard}.schema.json` | `run.json` matches §7.1 exactly (validity `byok_zero`/`models_allowlisted`/`post_teardown_records`/`voided`, `openrouter_key_name`, per-trial token breakdown + `generation_ids`); leaderboard CLI verified end-to-end; **minisign signing is a stub** |
| 9 Web UI rewire | ✅ | `ui/` (React SPA) + `web/*.html` (static fallback) | v2 SPA: leaderboard + run-detail reading `results/*.json`; v1 grader/receipts/**ethers removed** (bundle 246→190 KB), OAuth kept; typechecks + builds clean. Not visually verified here (no browser) |
| 10 Participant kit | ✅ | `kit/arena.mjs`, `kit/smoke.mjs` | `init`/`check`/`verify-pi`/`smoke`/`report` built + tested. `smoke` cost = the key's own **usage-ledger delta** (`cost_source: "ledger"`), not pi self-report (§6.5); transcript kept as a labeled fallback. Only the Harbor *spawn* needs a key at runtime |
| 11 Baseline probe + freeze | ⛔ | `runner --type baseline` + `docs/baseline-probe.md` | code path + doc done; **the run needs a key** (fills the two `-1` sentinels) |
| 12 Improvement-loop skill | ✅* | `kit/skill/SKILL.md` | *built as the **revised** one-pager (D22-minimal); **not** the R1–R6 budgeted-autonomy version in the original text |

Plus the runner (`competition/runner.mjs`) — the §6.1 orchestrator, built + tested with mocked seams.

## Deliberate deviations from the pre-revision spec
- **D19**: Node `.mjs`, not Python `pipeline/arena_pipeline/`. Only `agent/pi_agent.py` is Python (Harbor forces it).
- **§6.6 skill**: minimal one-pager, not R1–R6 autonomy — per the maintainer's revised D22.
- **judge prompt**: `competition/anti-abuse/judge-prompt.md`, not `judge/prompts/v1.md`.
- **Teardown**: quarantined to `legacy/`, not deleted.

## Correct-but-unvalidated (`VERIFY`-marked in code — need a key to confirm the wire format)
The logic matches the spec; these OpenRouter HTTP shapes are written to the documented
format but unconfirmed without a live key:
- `openrouter.keyGenerations(mgmt, hash)` — list a minted key's generation records (§6.1.5/6).
- `openrouter.selfKeyUsage(key)` — the participant key's own billed usage (`arena smoke`, §6.5).
- `mintKey`/`keyStatus`/`generation` — Provisioning field names (§6.1.3–5).

## Genuinely not implemented (execution, not code — all externally blocked)
- Live judge (WP5), baseline probe + config freeze (WP11), and the actual Harbor *spawn* in
  `arena smoke`/`runner` → **need an OpenRouter mgmt key (+ credits) and an Anthropic key**.
- Eval-box provisioning + empirical egress allowlist (WP7) → **needs the bare-metal box**.
- T+30min ledger re-check (§6.1.7) — deliberately unbuilt (its logic depends on how the ledger
  behaves for a *deleted* key; can't write it correctly without observing the live API).

Everything that is code-and-docs is written, tested (61 node + 6 pytest green), committed, and
pushed to `origin/v2`. What's left can't be turned into code — it needs the two keys and the box.

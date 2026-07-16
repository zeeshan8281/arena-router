# Baseline probe & config freeze (WP11)

The two `-1` sentinels in `competition.toml` — `smoke.gate` and `full.eligibility_bar` —
are the only numbers the spec can't know until vanilla pi + GLM 5.2 actually runs the
bench. `config.assertRunnable()` refuses official (non-baseline) runs while either is `-1`.
This is the one-PR procedure that fills them.

## Prerequisite
An **OpenRouter management key** (`OPENROUTER_MANAGEMENT_KEY`) and a provisioned eval box
(or a local run with Docker + harbor, see `competition/LOCAL_SETUP.md`). The baseline run
is **cap-exempt** (D2) — `runner.mjs` skips the budget/cap gate for `--type baseline`.

## 1. Run the probe
```bash
OPENROUTER_MANAGEMENT_KEY=sk-or-... \
  node competition/runner.mjs --type baseline --author _baseline
# → results/runs/pr0-baseline-a1.json  { median_pass_count, median_billed_usd, ... }
```
This runs the full 89-task bench once (D14 single trial) with the baseline model
(`models.baseline_model`), pulls billed cost from the key ledger, and writes a
`run_type: "baseline"` result. The leaderboard pins this row (§7.2).

## 2. Freeze the numbers
Read `median_pass_count` (call it `B`) from the probe result, then edit `competition.toml`:

| field | set to | rationale |
|---|---|---|
| `full.eligibility_bar` | `B` | must match the baseline pass count to qualify (D16) |
| `smoke.gate` | `B_smoke − 1` | absolute smoke pass count; announced as "baseline − 1" (smoke-subset §6) |

Also sanity-check the caps (D5): if the probe's billed cost is far from the assumed
`$1.50 smoke / $10 full`, recalibrate `smoke.cap_usd` / `full.cap_usd` so a legitimate run
can't hit the cap mid-bench.

`B_smoke` = the baseline's pass count **on the 16 smoke tasks** (parse the probe's
per-task `pass_vector`, or run one `--type smoke` baseline). Keep it separate from the
89-task `B`.

## 3. Commit
One PR touching `competition.toml` only. Once merged, `pendingTbd(config)` returns `[]`
and `assertRunnable()` permits smoke/full runs — the pipeline is live.

## Verify it worked
```bash
node -e 'import("./competition/scoring/config.mjs").then(m=>console.log(m.pendingTbd(m.loadConfig())))'
# → []   (was: [ 'smoke.gate', 'full.eligibility_bar' ])
```

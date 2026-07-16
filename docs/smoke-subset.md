# Smoke Subset — Terminal-Bench 2.x

Companion to [benchmark-cost-survey.md](./benchmark-cost-survey.md). Defines the fixed 16-task smoke set used for local iteration and as the CI gate before the full 89-task run.

Decisions locked 2026-07-16:

- **Size: 16 tasks**, same set for local iteration and CI, fully public. (Faster/cheaper local iteration is a possible future improvement — punted for now.)
- **Gate threshold: frozen to an absolute number after the baseline probe run** (vanilla pi + GLM 5.2). Announced as "baseline − 1" until then.
- **Image set pinned to Terminal-Bench 2.0 Verified / 2.1** (`xiangyangli/<task>:20260204` rebuilds). The Verified fixes (procps/python3 installed everywhere, nproc cap, instruction corrections) remove environment-caused failures that would otherwise add noise to both smoke and full runs.

## 1. Purpose

Two jobs, one task list:

1. **Local iteration signal** — a participant runs it with their own OpenRouter key and gets a pass count + billed cost that predicts how the full run will rank them.
2. **CI gate** — a PR must clear it before the maintainer-funded full 89-task run fires.

It is a **gate, not the score**. The full run decides the leaderboard. Gaming the smoke set only buys admission to the run that actually counts, which is why the set can be public.

## 2. Composition rules

Derived from the full task registry (`laude-institute/terminal-bench-2`, 89 tasks, all `task.toml` metadata parsed 2026-07-16):

- **Exclude the 5 multimodal-flagged tasks** (`code-from-image`, `chess-best-move`, `financial-document-processor`, `path-tracing`, `extract-moves-from-video`) — most of the 8 allowlisted models are text-only.
- **Exclude runtime outliers** (`build-pov-ray` 12000s, `sam-cell-seg` 7200s, and the 3600s tier) — any one would dominate smoke wall-clock and cost.
- **Stratify proportionally** to the full bench: 55 medium / 30 hard / 4 easy across 16 categories, software-engineering dominant (26/89).
- **Include one 1800s-tier task** so the caching/context-management levers participants tune are actually exercised; everything else from the cheap 900s / 1-CPU / 2GB tier.

## 3. The 16 tasks

| # | Task | Category | Difficulty | Agent timeout |
|---|------|----------|------------|---------------|
| 1 | fix-git | software-engineering | easy | 900s |
| 2 | git-leak-recovery | software-engineering | medium | 900s |
| 3 | pypi-server | software-engineering | medium | 900s |
| 4 | kv-store-grpc | software-engineering | medium | 900s |
| 5 | write-compressor | software-engineering | hard | 900s |
| 6 | nginx-request-logging | system-administration | medium | 900s |
| 7 | configure-git-webserver | system-administration | hard | 900s |
| 8 | modernize-scientific-stack | scientific-computing | medium | 600s |
| 9 | sanitize-git-repo | security | medium | 900s |
| 10 | password-recovery | security | hard | 900s |
| 11 | query-optimize | data-science | medium | 900s |
| 12 | custom-memory-heap-crash | debugging | medium | 1800s |
| 13 | db-wal-recovery | file-operations | medium | 900s |
| 14 | model-extraction-relu-logits | mathematics | hard | 900s |
| 15 | regex-log | data-processing | medium | 900s |
| 16 | pytorch-model-cli | model-training | medium | 900s |

Profile: 1 easy / 11 medium / 4 hard across 10 categories — an 18% proportional sample of the full bench. All tasks 1 CPU / 2048 MB. Worst-case total agent budget ≈ 15,000s; at `--n-concurrent 4` that is ≤1 hour wall clock, typically far less.

Note: `pypi-server` was among the 14 tasks affected by the missing-`procps` crash bug — fixed in the pinned Verified images, one of the reasons for pinning.

## 4. Running it

Harbor has no lite-dataset or category-filter mechanism; subset selection is by repeatable `-i` name globs:

```sh
harbor run -d terminal-bench/terminal-bench-2 \
  -i fix-git -i git-leak-recovery -i pypi-server -i kv-store-grpc \
  -i write-compressor -i nginx-request-logging -i configure-git-webserver \
  -i modernize-scientific-stack -i sanitize-git-repo -i password-recovery \
  -i query-optimize -i custom-memory-heap-crash -i db-wal-recovery \
  -i model-extraction-relu-logits -i regex-log -i pytorch-model-cli \
  -m "<model>" -a "<agent>" --n-concurrent 4
```

The participant kit wraps this in a single command.

## 5. Trials and scoring

- **Median-of-3 trials** per smoke evaluation. Per-task token usage varies up to 30x across runs; a single trial is noise.
- Each trial scored independently: tasks passed + total billed dollars from OpenRouter generation records (cache telemetry included).
- Report the **median pass count** and **median cost** across the 3 trials. Not pass@3 (inflates), not mean (outlier-sensitive).
- **Smoke gate = pass count only.** Cost is recorded and displayed but not gated at smoke stage — cost judgment belongs to the full run, where it is measured properly.
- Estimated cost per trial, vanilla pi + GLM 5.2: **$3–8** (900s timeouts cap token burn; optimized harnesses run cheaper). A full median-of-3 local iteration: roughly $10–25 unoptimized.

## 6. Gate threshold

Cannot be set before the baseline probe (vanilla pi + GLM 5.2 on the full 89, punted until OpenRouter key usage refreshes). Shape:

- Baseline probe yields a smoke pass count `B`.
- Gate announced as `≥ B − 1` (one task of noise margin), then **frozen to that absolute number** in the rules so participants aren't chasing a moving target.

## 7. Validation plan (post-probe)

Run 2–3 harness variants (vanilla pi; pi + compaction plugin; a lean agent profile) on both the smoke set and the full 89:

- Check smoke cost rank predicts full-run cost rank (Spearman).
- If predictiveness is poor, rebalance the timeout mix (more 1800s representation) rather than growing the set.

## 8. Open items

- Baseline probe run (blocks the gate number and validation).
- Future: an even cheaper local iteration tier (e.g. 5-task micro-set or single-trial mode) — explicitly punted.

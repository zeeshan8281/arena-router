---
name: arena-improve
description: "Use when iterating on an AutoRouter Arena v2 submission to lower its billed OpenRouter cost while holding pass count. Drives the analyze → edit → cheap-trial → confirm loop over the `arena` CLI. Only hard dependencies are the `arena` CLI and a shell; agent-agnostic (Claude Code, pi, Codex)."
---

# AutoRouter Arena — improvement loop

Dev tooling for tuning a submission in `submissions/<login>/`. It enforces nothing
and scores nothing — CI does that. The goal: **fewer billed OpenRouter dollars at the
same (or better) pass count**. Run one turn of this loop per change.

Prerequisites: the `arena` CLI on PATH and a shell. Nothing host-specific.

## The loop

1. **Analyze (free).** Read the last run's `--out` artifacts and the pi transcripts
   they point to. Hunt cost sinks and repeated failures: cache misses, bloated
   context, redundant turns, retries. `arena report` gives the cost/pass table with
   deltas vs the previous run — start there, then open the transcripts behind the
   worst-offending tasks. No spend at this step.

2. **Edit — one change at a time.** Make a single change, inside
   `submissions/<login>/` only. **Never touch `vendor/pi/`** (any diff there is an
   automatic CI block) or anything outside your submission dir. Run `arena check`
   after every edit to catch path / manifest / tripwire problems locally before you
   spend anything.

3. **Cheap trial (~$1–3).** `arena smoke --trials 1`, scoped to the tasks you
   changed with `--tasks <affected>`, writing artifacts with `--out <dir>`. Judge
   **direction, not victory** — a single trial is noisy, so a lone win or loss is not
   a verdict. Keep changes that clearly move cost down without dropping passes;
   discard the rest.

4. **Confirm.** For any change worth keeping, run `arena smoke --trials 3` and read
   the **median** pass count and median billed dollars. That median-of-3 is the
   number comparable to the CI smoke gate — trust it, not the single trial.

Then return to step 1 with the next change.

> **Task-agnosticity.** Your harness must stay general — no task names, baked-in
> solutions, or benchmark-conditional branching. The judge prompt is public at
> `judge/prompts/v1.md` and **blocks on `suspicious`**. Read it and self-check before
> you consider a change a keeper.

> **Watch your spend.** Per-trial billed dollars come from **your own** OpenRouter
> generation records (surfaced in the `--out` artifacts and `arena report`). Note
> them as you go so a cheap loop doesn't quietly become an expensive one.

**Out of scope for v1:** autonomy budgets, convergence detection, and trajectory
reporting. Do not build or assume them — this is the whole loop.

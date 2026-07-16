# AutoRouter Arena v2 — participant quickstart

A harness-efficiency competition. You ship a **pi configuration** — plugins, skills,
profiles, settings — that solves Terminal-Bench tasks for as **few billed OpenRouter
dollars as possible** while still passing enough tasks to clear the bar. You do not
edit the benchmark, the agent, or the pipeline; you only tune how pi is configured.

## What goes in your submission directory

Copy this template to `submissions/<your-github-login>/` and fill it in:

| Path            | Contents                                                        |
|-----------------|-----------------------------------------------------------------|
| `manifest.toml` | Entry metadata + optional profile entrypoint (see the file).    |
| `plugins/`      | pi plugins (optional).                                           |
| `skills/`       | pi skills (optional).                                            |
| `profiles/`     | pi agent profiles, e.g. `main.toml` referenced by the manifest. |
| `config/`       | pi settings/config files (optional).                            |

Everything except `manifest.toml` is free-form pi configuration. The directory is
mounted **read-only** into the harness at pi's config path during evaluation.

## Iterate locally

Local runs need Python + `uv` (for Harbor and the pi adapter) and your own
OpenRouter key — the same boundary CI uses.

```sh
arena init                       # scaffold submissions/<your-login>/ from this template
arena check                      # static checks: path / manifest / tripwire (run after every edit)
arena smoke --trials 1           # one cheap trial (~$1–3) — direction, not victory
arena report                     # cost/pass table with deltas vs the previous run
arena smoke --trials 3           # median-of-3 — the number comparable to the CI gate
```

Scope trials to the tasks you're working on with `--tasks <subset>`, and write
machine-readable per-task artifacts with `--out <dir>` (feeds `arena report` and the
improvement-loop skill in `kit/skill/SKILL.md`). Billed dollars come from your own
OpenRouter generation records. `arena verify-pi` confirms your vendored pi checksum
matches `competition.toml`.

## The task-agnosticity rule

Your harness must be **general**. No task names, no baked-in solutions, no
benchmark-conditional branching. A static tripwire plus a public LLM judge
(`judge/prompts/v1.md`) review every diff; the judge **blocks on `suspicious`**.
Read the judge prompt and self-assess before opening a PR — it is public by design.

## How you're ranked

- Open a PR that touches **only** `submissions/<your-login>/**` (see the hard rules
  in `manifest.toml`).
- CI runs a smoke gate, then the full 89-task benchmark on pass.
- An entry is **eligible** only if it meets the baseline pass count.
- Among eligible entries, the leaderboard ranks by **lowest billed OpenRouter
  dollars** — cheapest harness that clears the bar wins. Below-bar entries are shown
  separately with their pass count so near-misses stay visible.

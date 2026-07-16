# CI Anti-Abuse & Spend Containment

Companion to [benchmark-cost-survey.md](./benchmark-cost-survey.md) and [smoke-subset.md](./smoke-subset.md). CI is org-funded; this doc defines how we keep that safe. A submitted PR is **arbitrary code** (plugins, skills, agent profiles) that CI executes with funded inference, so there are four distinct surfaces:

1. **The money** — runaway or malicious spend.
2. **The key** — exfiltration (harness code can read its own environment).
3. **The score** — gaming cost or pass rate instead of earning it.
4. **The pipeline** — CI as free compute, or griefing via submission volume.

Decisions locked 2026-07-16: spend caps set at $1.50 smoke / $10 full / $30 per-author-month; full run triggers **automatically on smoke pass** (marked as needing more thought); benchmark-overfitting detection via **LLM judge** on the submission diff; **egress allowlisting confirmed for v1**.

## 1. Spend containment: per-run provisioned keys

No long-lived org key ever enters CI. OpenRouter's Provisioning API (`POST/GET/PATCH/DELETE /api/v1/keys`, authenticated by a separate management key that cannot perform inference) supports minting keys with a hard credit `limit` and reading per-key `usage` / `limit_remaining` / `byok_usage`.

Per run:

1. CI mints a fresh key named `pr-<number>-<run-type>-<attempt>` with `limit` set to the cap for the run type.
2. The key is injected **only into the harness container** — never the verifier or the workflow env at large.
3. On completion, CI pulls the key's generation records — this is the official cost number for scoring (ground truth from OpenRouter's ledger, unspoofable by the harness) — then deletes the key.
4. A key that exhausts its limit mid-run simply starts failing inference; remaining tasks fail and the run is scored as-is. The blast radius of any single PR is the cap.

Key exfiltration is thereby neutered as a spend attack: a leaked key is capped and dies minutes after the run. Any generation record timestamped after run teardown is flagged as an incident.

### Caps

| Cap | Amount | Notes |
|---|---|---|
| Smoke run | **$1.50** | per run (median-of-3 trials share one key) |
| Full run (89 tasks) | **$10** | |
| Per-author monthly budget | **$30** | tracked from the key ledger; exceeded → smoke-only until next month |

**Calibration caveat:** the survey's estimate for *unoptimized* vanilla pi + GLM 5.2 is $3–8 per smoke trial and ~$60 (cached) per full run — above these caps. The caps are deliberately tight: the competition rewards cheap harnesses, and CI should not fund expensive ones. Consequences to accept explicitly:

- The **baseline probe run is exempt** (run manually outside CI with its own budget).
- Early/naive submissions may hit the cap and score poorly on incomplete runs — that is working as intended, but the numbers should be **sanity-checked against the baseline probe** before launch so that a *reasonably* optimized harness fits comfortably. Revisit after probe.

## 2. Rate limits: a funnel, each layer cheaper than the one it protects

| Layer | Trigger | Cost to org | Limits |
|---|---|---|---|
| Static checks + LLM judge (§3) | every push | ~$0 + one cheap judge call | none |
| Smoke gate | auto for contributors with a prior merged PR; maintainer approval for first-timers | ≤$1.50 | 2 smoke runs / PR / day; 1 concurrent run per author |
| Full run | **auto on smoke pass** | ≤$10 | 1 full run / PR / day; org-wide concurrency 1–2 |

Mechanics:

- Plain `pull_request` event (fork PRs get no secrets) plus a GitHub **environment with required reviewers** holding the management key. First-time contributors need one human approval to reach smoke; after that the funnel is automatic.
- **Full-run trigger is auto-on-smoke-pass — flagged as needing more thought.** The concern: anyone who can pass smoke (2×/day) can burn a $10 full run daily with no human in the loop; a coordinated set of accounts multiplies that. The tight caps and per-author monthly budget bound the damage (~$300/month per 10 hostile authors, before concurrency limits slow them further). If that proves too loose in practice, the fallback is a maintainer label (`run-full-bench`) gating the full run — a one-click cost per legitimate submission. Revisit after the first weeks of real traffic.
- Stale-PR rule: no runs on PRs more than N days behind the base branch without a rebase.

## 3. Score integrity

**Terminal-Bench tasks are fully public, solutions included** — every task dir in `laude-institute/terminal-bench-2` ships a `solution/`. There is no hidden set. The winning cheat is not stealing answers, it is **embedding them**: a lookup table of 89 solutions scores 100% at near-zero inference cost.

### 3a. Task-agnosticity rule + LLM judge

Bright-line rule: **submissions may not contain task-specific content** — no task names, no solution strings, no benchmark-conditional branching ("if the prompt mentions FEAL ciphers...").

Enforcement is layered:

1. **Static tripwire** (free, every push): grep the diff for the 89 task IDs and a curated list of distinctive solution strings. Catches lazy embedding.
2. **LLM judge** (every push, cheap model, runs on the submission diff): judges whether the harness is *overly catered to the benchmark* rather than generally useful. The judge sees the diff plus the task-agnosticity rule and returns a graded verdict:
   - `clean` — proceeds to smoke automatically.
   - `suspicious` — proceeds, but the PR is labeled for mandatory human review before any leaderboard placement; the judge's rationale is posted as a PR comment so the author can respond.
   - `violation` — run blocked pending maintainer override.

   Judge design notes: prompt it to look for task-name/solution knowledge in disguised form (encoded strings, oddly specific heuristics matching known tasks, category-specific hardcoding that mirrors the TB category list), benchmark-shaped prompt engineering ("you are solving a Terminal-Bench task"), and skills whose usefulness collapses outside the 89 tasks. The judge is a **triage tool, not the verdict** — final calls on `suspicious`/`violation` are human. Judge model should be cheap (this runs on every push) and its prompt versioned in-repo so authors can read exactly what is being checked.
3. **Mandatory human diff review** before prize/top-leaderboard placement regardless of judge verdict. Diffs are plugins/skills/configs — small and reviewable by design.
4. **Anomaly flag in scoring**: a pass with implausibly low tokens (e.g. a hard task solved in <5k total tokens) auto-flags for review; not auto-disqualifying.

The LLM judge replaces the earlier perturbed-holdout idea as the primary overfitting defense (holdout variants remain an option for adjudicating contested cases at season end, but nobody has to maintain secret mutated tasks year-round).

### 3b. All inference through the provisioned key

Cost is only meaningful if it is the *whole* cost:

- **BYOK banned** — assert `byok_usage == 0` on the run key; nonzero voids the run.
- **`:free` model variants banned** (decided in the allowlist; enforced here).
- **Model allowlist enforced at run time**: generation records name the model per request; any record outside the 8-model allowlist voids the run.
- **Egress allowlisting — confirmed for v1**: task containers get network egress restricted to `openrouter.ai` plus the package registries the pinned task images legitimately need (PyPI, npm, apt mirrors, etc. — derive the exact list from the Verified images). This closes the "offload reasoning to a free external endpoint" hole that rules alone cannot. Implementation: runner-level network policy around Harbor's Docker containers (docker network + proxy allowlist, or host firewall on the runner). This is the one v1 item with real infra work; the registry allowlist will need iteration as tasks legitimately fetch dependencies.

## 4. Pipeline abuse

Largely covered above: task timeouts come from the pinned Verified images (600–1800s for the smoke set), no TB task uses a GPU, egress allowlisting kills freeloading (mining, proxying), and concurrency caps stop queue flooding. The funnel's per-author limits handle volume griefing.

## Open items

- Recalibrate all three caps against the baseline probe run (smoke cap currently below the *unoptimized* baseline estimate — intentional, but verify a reasonably optimized harness fits).
- Full-run trigger (auto vs maintainer label) — revisit after initial real traffic. **Marked as needing more thought.**
- LLM judge: choose judge model, write + version the judge prompt, decide where verdicts are stored (PR comment + label proposed above).
- Egress allowlist: enumerate registries the Verified images actually need; pick enforcement mechanism (docker network policy vs proxy).
- Incident playbook: what happens on a flagged post-teardown generation record or a voided run (disqualification tiers, appeal path).

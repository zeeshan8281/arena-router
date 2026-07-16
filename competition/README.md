# AutoRouter Arena — v2: the harness-efficiency competition

> **Branch `v2` — work in progress.** `main` still holds v1 (the attested
> multi-stage routing grader, live on sepolia). Nothing here touches it.

## The pivot

Make an AI coding agent **as cheap as possible without making it dumber.**

- **Same harness for everyone:** vanilla `pi` CLI on OpenRouter. You may add
  plugins, skills, agent profiles, config — anything *except* modifying `pi`.
- **Benchmark:** Terminal-Bench 2.x (89 terminal-native tasks, pinned to the
  Z.ai Verified / 2.1 image set).
- **Baseline:** plain GLM 5.2 on vanilla `pi`. Match/beat its pass rate, then
  **lowest inference spend wins.**
- **Score = the ledger.** Actual billed dollars from OpenRouter's generation
  records (caching and every secondary effect included). No modeling, no
  self-reporting.
- **Flow:** iterate locally on a public smoke set → open a PR → CI smoke gate →
  passing triggers the org-funded full run → leaderboard.

Full design in [`docs/`](../docs): `benchmark-cost-survey.md`,
`smoke-subset.md`, `ci-anti-abuse.md` (PR #2).

## Implemented so far

### ✅ `anti-abuse/` — task-agnosticity defense (ci-anti-abuse §3a)
TB is public *with solutions*, so the cheat is embedding answers. Layered,
triage-only checks (humans make the final call):

- **`tripwire.mjs`** — static scan of a submission diff for the real **89 task
  IDs** (`task-ids.txt`, fetched from `laude-institute/terminal-bench-2`) and
  curated **solution strings** (`solution-strings.txt`, seeded empty). Boundary-
  matched (so `fix-github` ≠ `fix-git`); scans added lines only; skips our own
  tooling. Exit 1 on a hit.
- **`judge.mjs` + `judge-prompt.md`** — LLM judge on the diff →
  `clean` / `suspicious` / `violation`. Prompt **versioned in-repo** for
  transparency; ready to run with `OPENROUTER_API_KEY`.
- 9 offline tests (`node --test competition/anti-abuse/*.test.mjs`), all green.

See [`anti-abuse/README.md`](./anti-abuse/README.md).

## Known limitation / risk — published results expose the task list

Each committed `results/runs/<id>.json` includes a `pass_vector` keyed by the
**real Terminal-Bench task names** with per-task pass/fail, and the run-detail UI
renders that grid. This is a deliberate current tradeoff (transparent, auditable
results) but it is in tension with the task-agnosticity rule the `anti-abuse/`
checks enforce: it publicly reveals which tasks are in the set and exactly which
a given harness passed or failed — a milder analog of the v1 hidden-set
exfiltration exploit. An adversary can read the task inventory and per-task
outcomes straight from the published leaderboard.

**Status:** kept as-is for now by maintainer decision. **Mitigations** for a
future change, when we decide the exposure outweighs the transparency benefit:

- **Hash the task IDs** in `pass_vector` (e.g. HMAC with a per-competition
  salt) so the grid still shows pass/fail counts and stable per-task columns
  without leaking the human-readable task names.
- **Drop the per-task vector** from the published run file entirely and expose
  only aggregate `pass_count` / `median_pass_count`, keeping the detailed vector
  internal to scoring.

Either change is schema-only + UI-only and does not affect how runs are scored.

## Planned (not yet built)

| Slice | Source | Status |
|---|---|---|
| **Scoring / ledger core** — provision capped OpenRouter key, pull billed $, enforce allowlist + BYOK=0 + token-anomaly | ci-anti-abuse §1,§3b | next; buildable now, live-validate with a mgmt key |
| **CI pipeline** — PR → tripwire/judge → smoke gate → full run → leaderboard | ci-anti-abuse §2 | skeleton pending |
| **Participant kit** — vanilla-`pi` harness layout, plugin/skill/config contract, smoke-run wrapper | smoke-subset §4 | needs `pi`/`harbor` interface |
| **Baseline probe + gate threshold** | smoke-subset §6 | **blocked on OpenRouter key refresh** |

## Blocked / open

- `harbor`, `pi`, `terminal-bench`, and an OpenRouter key are **not** in the dev
  environment yet — so real benchmark runs and the **baseline probe** can't run
  locally. Everything above is plumbing built against the docs + unit-tested.
- Open design questions (from PR #2): full-run trigger (auto vs. maintainer
  label), held-out private set vs. LLM-judge-only overfitting defense, judge
  model choice, repo-migration scope (quarantine v1 → `legacy/`).

## What carries over from v1

Leaderboard concept, GitHub identity, the repo. The enclave grader / attestation
/ multi-stage live-inference stack is **superseded** — v2's trust comes from
Terminal-Bench's deterministic tests + OpenRouter's ledger, neither of which
needs a TEE.

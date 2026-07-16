# Implementation Spec — Harness-Efficiency Competition

**Status:** ready for implementation handoff. This document is the authoritative build spec; it is written to be executed by implementation agents working package-by-package (§10) without further design decisions. Where a value cannot be known until the baseline probe runs, it is marked `TBD(probe)` and lives in `competition.toml` (§8) — implementers wire the plumbing, not the number.

Companion docs (policy rationale, already merged into this PR):

- [benchmark-cost-survey.md](./benchmark-cost-survey.md) — why Terminal-Bench 2.x, pricing foundation, model allowlist derivation.
- [smoke-subset.md](./smoke-subset.md) — the 16-task smoke set, trials, gate shape.
- [ci-anti-abuse.md](./ci-anti-abuse.md) — threat model, caps, funnel, judge policy.

This spec supersedes those docs wherever they conflict (a handful of policies were tightened after they were written; see §1.1).

---

## 1. System overview

Participants modify a **vanilla pi CLI harness** connected to OpenRouter — plugins, skills, agent profiles, configuration; anything except pi's source — to minimize inference spend on **Terminal-Bench 2.x** while passing at least as many tasks as the vanilla-pi + GLM 5.2 baseline. Score = **actual billed dollars from OpenRouter's generation ledger**.

Flow:

```
participant iterates locally (own key, 16-task smoke set, kit CLI)
        │  opens PR: submissions/<github-login>/
        ▼
┌─ every push ────────────────────────────────────────────────┐
│ static checks (paths, vendored-pi immutability, tripwire)   │
│ LLM judge on the diff (Sonnet 4.6) — blocks on suspicious+  │
└──────────────┬──────────────────────────────────────────────┘
               ▼ clean
┌─ smoke gate (self-hosted runner) ───────────────────────────┐
│ mint capped key ($1.50) → median-of-3 × 16 tasks → ledger   │
│ pull → gate on pass count ≥ SMOKE_GATE                      │
└──────────────┬──────────────────────────────────────────────┘
               ▼ pass (automatic)
┌─ full run (self-hosted runner) ─────────────────────────────┐
│ mint capped key ($10) → 1 × 89 tasks → ledger pull →        │
│ validity assertions → results JSON committed to main        │
└──────────────┬──────────────────────────────────────────────┘
               ▼
leaderboard regenerated (static JSON) → web UI
```

### 1.1 Decision ledger (locked 2026-07-16/17)

| # | Decision | Value |
|---|----------|-------|
| D1 | Benchmark | Terminal-Bench 2.x, 89 tasks, images pinned to TB 2.0 Verified / 2.1 (`xiangyangli/<task>:20260204`) |
| D2 | Baseline | vanilla pi + `z-ai/glm-5.2`; probe run pending (outside CI, exempt from caps) |
| D3 | Model allowlist | the 8 verified open-weights models (survey §10.1); `:free` variants banned |
| D4 | Smoke set | fixed 16 tasks (smoke-subset.md §3), median-of-3, gate on pass count only |
| D5 | Spend caps | $1.50 smoke / $10 full / $30 author-month, per-run provisioned keys |
| D6 | Full-run trigger | automatic on smoke pass (needs-more-thought flag stands; fallback = maintainer label) |
| D7 | Foundation | **hybrid** — greenfield eval pipeline; carry over web UI + GitHub OAuth identity; router/grader/attestation retired |
| D8 | Repo | **pivot arena-router in place**, no backwards compatibility required (repo has no critical traffic) |
| D9 | Compute | **self-hosted dedicated bare-metal** runner (Hetzner AX52-class, 16 cores/64 GB, ~$70–120/mo); Docker-capable, so a future Harness-Bench tier needs no infra change |
| D10 | Submissions | **dir-per-author monorepo**: PRs into `submissions/<github-login>/` |
| D11 | Automation scope | **fully automated end-to-end** — no human-in-the-loop steps in the happy path, including first-time contributors (judge + caps are the only gate) |
| D12 | Judge gating | judge blocks on **`suspicious` and `violation`**; block reason must be trivially surfaceable to both submitter and admins (§5.3) |
| D13 | Judge model | **Claude Sonnet 4.6** (`claude-sonnet-4-6`), Anthropic API — deliberately outside the competition model pool |
| D14 | Full-run trials | **single trial** (89 tasks self-average; median-of-3 stays smoke-only) |
| D15 | Results store | **committed to repo**: bot commits per-run JSON + regenerated leaderboard to `results/` on main; web UI reads static JSON |
| D16 | Eligibility bar | full-run pass count ≥ `B_full` — frozen absolute after probe, no noise margin; rank eligible entries by lowest billed dollars |
| D17 | Season rules | **out of scope** — spec the live leaderboard only; prizes/finalization designed later |
| D18 | Egress enforcement | **HTTP(S) proxy allowlist** (squid, CONNECT-hostname rules) on an internal-only Docker network |
| D19 | Stack | **Node/TypeScript** for pipeline + participant kit, reusing the tested HTTP/JSON/git glue already in this codebase; **Python only where Harbor forces it** — the single agent-adapter file it loads via `--agent-import-path` (§6.2). Boundary = `harbor` subprocess + JSON artifacts. Web UI stays TypeScript; UI boundary = static `results/` JSON. *(Revised from all-Python: the only hard Python dependency is the adapter file — rewriting working Node glue for language uniformity is discarding tested code for no functional gain.)* |
| D20 | pi version | **vendored into the repo** (`vendor/pi/`, current latest release at implementation time); any diff touching `vendor/` = automatic block |
| D21 | Improvement-loop skill host | **agent-agnostic** — a `SKILL.md` playbook + kit CLI usable from any coding agent (Claude Code, pi, Codex); no host-specific affordances |
| D22 | Skill scope | **minimal v1** — ship the load-bearing CLI (`arena smoke --trials 1 --tasks --out` + `arena report`) plus a one-page `SKILL.md` describing the loop (analyze → edit → cheap trial → confirm). Autonomy budgets, convergence detection, and trajectory machinery **deferred** until a participant actually wants them — it's dev tooling; it enforces nothing and scores nothing. *(Revised from a budgeted-autonomous-loop spec with R1–R6 requirements: iteration machinery designed before anyone has run a loop.)* |

Supersessions of ci-anti-abuse.md: D11 removes the "first-timers need one human approval" step (§2 of that doc); D12 hardens judge `suspicious` from proceed-with-label to block.

---

## 2. Repo layout (post-pivot)

```
arena-router/
├── competition.toml              # single source of config truth (§8)
├── vendor/
│   └── pi/                       # frozen pi checkout — IMMUTABLE (D20)
├── submissions/
│   ├── _template/                # scaffold copied by the kit
│   └── <github-login>/           # one dir per participant (D10)
│       ├── manifest.toml         # entry metadata (§4.1)
│       ├── plugins/              # pi plugins (optional)
│       ├── skills/               # pi skills (optional)
│       ├── profiles/             # pi agent profiles (optional)
│       └── config/               # pi settings/config files (optional)
├── results/
│   ├── runs/<run-id>.json        # one file per official CI run (§7.1)
│   ├── runs/<run-id>.json.minisig
│   └── leaderboard.json          # regenerated after every full run (§7.2)
├── pipeline/                     # Node/TS package: all CI orchestration glue (§3–§7, D19)
│   ├── package.json              # Node ≥22, TypeScript; reuses existing tested glue
│   ├── src/
│   │   ├── config.ts             # competition.toml loader + validation
│   │   ├── keys.ts               # OpenRouter Provisioning API client
│   │   ├── ledger.ts             # generation-record pull, cost + validity
│   │   ├── checks.ts             # static checks + tripwire
│   │   ├── judge.ts              # Anthropic judge client + surfacing
│   │   ├── runner.ts             # smoke/full orchestration; spawns `harbor` subprocess
│   │   ├── results.ts            # results JSON, signing, leaderboard gen
│   │   └── budget.ts             # per-author monthly ledger
│   ├── data/tripwire.txt
│   └── test/
├── agent/                        # the ONE forced-Python component (D19)
│   ├── pyproject.toml            # Python ≥3.12, managed with uv; deps: harbor
│   └── pi_agent.py               # Harbor agent adapter for pi (§6.2), loaded via --agent-import-path
├── kit/                          # participant CLI (§6.5) — thin wrapper over pipeline/src
│   └── skill/
│       └── SKILL.md              # agent-agnostic improvement-loop skill (§6.6)
├── judge/
│   └── prompts/v1.md             # versioned judge prompt (public by design)
├── infra/                        # runner provisioning + proxy (§6.4)
│   ├── runner-setup.md
│   ├── squid/squid.conf
│   └── docker-compose.yml        # gh runner + squid on the eval box
├── web/                          # carried-over UI, rewired to results/ JSON (§7.3)
├── .github/workflows/
│   ├── checks.yml                # static + judge, every push (§5)
│   ├── smoke.yml                 # smoke gate (§6)
│   ├── full-run.yml              # full benchmark (§6)
│   └── leaderboard.yml           # regen + commit (§7)
└── docs/                         # this spec + companions
```

**Teardown (D7/D8):** delete `src/router/`, the grader, backend-worker, attestation/receipt crypto, ring store, and their tests/scripts. Keep `web/` (SPA + GitHub OAuth Vercel functions) and anything it imports. **Salvage before deleting (D19):** the existing tested Node glue — HTTP clients, JSON/config handling, git/GitHub-API helpers, and their tests — moves into `pipeline/` rather than being rewritten; only router/grader/attestation *logic* is deleted. No compatibility shims — dead code is removed, not deprecated. Follow-on cleanup grep per the usual dead-code procedure.

---

## 3. Identity and permissions model

- **Participant identity = GitHub login** (carried over from the existing arena's verified-GitHub-identity decision). `submissions/<github-login>/` MUST equal the PR author's login — checked in §5.1; mismatch = block.
- One directory per author; an author's newer merged PR supersedes their older entry on the leaderboard (leaderboard shows each author's best eligible run, §7.2).
- **Secrets** live in a GitHub *environment* (`eval-runner`) bound to the self-hosted runner:
  - `OPENROUTER_MANAGEMENT_KEY` — Provisioning API only, cannot do inference.
  - `ANTHROPIC_API_KEY` — judge calls only.
  - `RESULTS_SIGNING_KEY` — minisign secret key for results files.
  - `RESULTS_BOT_TOKEN` — fine-grained PAT, contents:write on this repo only, used to push `results/` commits.
- Fork PRs get **no secrets** by default GitHub semantics. The judge job (needs `ANTHROPIC_API_KEY`) therefore runs via `pull_request_target` **with an explicit hard rule: never execute PR code in that context** — the judge only *reads the diff* (via the GitHub API, not a checkout of PR code). Smoke/full jobs run on the self-hosted runner against a checkout of the PR merge ref, gated behind the judge check.

---

## 4. Submission contract

### 4.1 `manifest.toml`

```toml
[entry]
author = "<github-login>"        # must match dir name and PR author
name = "my-cheap-harness"        # display name for leaderboard
description = "one-liner"

[harness]
profile = "profiles/main.toml"   # pi agent profile entrypoint (optional; vanilla if absent)
```

Everything else in the dir is free-form pi configuration. The submission is mounted read-only into the harness environment at pi's config path (exact path fixed by WP2 once the vendored pi version is pinned).

### 4.2 Hard rules (enforced, not advisory)

1. PR may only touch `submissions/<pr-author-login>/**`. Any other path → block (this single rule also protects `vendor/pi/`, workflows, pipeline code, and results from tampering).
2. No task-specific content (task names, solution strings, benchmark-conditional branching) — tripwire + judge (§5).
3. All inference through the injected per-run key: BYOK banned (`byok_usage == 0` asserted), models outside the D3 allowlist void the run, `:free` variants banned.
4. Network egress inside eval = proxy allowlist only (§6.4).
5. Size cap: submission dir ≤ 1 MB, ≤ 200 files (keeps judge diffs reviewable; generous for config/plugins).

Maintainer changes to `vendor/`, `pipeline/`, workflows etc. go through normal maintainer PRs — the path rule applies to submission PRs, identified as: any PR touching `submissions/`. A PR touching both `submissions/` and other paths is blocked outright.

---

## 5. Stage 1 — checks & judge (`checks.yml`, every push, ~free)

### 5.1 Static checks (fail-fast, no LLM)

Ordered; first failure blocks with a distinct check-run annotation:

1. **Path containment** — changed files ⊆ `submissions/<author>/**` (§4.2.1). This is the vendored-pi immutability check (D20): `vendor/` is outside the allowed set, so any attempt to modify pi blocks automatically with reason `vendored-pi-modification` (special-cased message so the submitter knows exactly what they did).
2. **Manifest validation** — parseable, author field matches dir and PR author, size caps.
3. **Tripwire grep** — diff scanned for the 89 TB task IDs and a curated list of distinctive solution strings (list maintained at `pipeline/data/tripwire.txt`; seeded from task names + high-signal strings from `solution/` dirs). Case-insensitive, plus base64/hex-encoded forms of task names.

### 5.2 LLM judge

- Model: `claude-sonnet-4-6` (D13). Prompt: `judge/prompts/v1.md`, versioned in-repo, public.
- Input: the PR diff (fetched via GitHub API — never a code checkout, §3) + manifest + the task-agnosticity rule text + the TB category/task-name list for reference.
- Output (JSON, schema-enforced): `{"verdict": "clean" | "suspicious" | "violation", "rationale": "...", "evidence": ["file:line …"]}`.
- Prompt content per ci-anti-abuse.md §3a judge design notes: disguised embedding (encoded strings, oddly-specific heuristics matching known tasks, category-mirroring hardcoding), benchmark-shaped prompt engineering, skills useless outside the 89 tasks.

### 5.3 Gating & surfacing (D12)

`clean` → proceed. `suspicious` or `violation` → **block** (smoke/full jobs `needs:` this check). The block reason must be visible in four places, all written by the judge job:

1. **GitHub Check Run** `harness-judge` — conclusion `failure`, full rationale + evidence in the check summary (what the submitter sees in the PR checks tab).
2. **PR comment** — sticky (find-and-update a single bot comment, never stack new ones), containing verdict, rationale, evidence lines, and appeal instructions.
3. **PR label** — `judge:clean` / `judge:suspicious` / `judge:violation` (admin dashboard filter).
4. **Judge log** — `results/judge-log.jsonl` appended by the leaderboard bot (verdict history per PR/SHA, for admin audit and false-positive tuning; rationale included).

**Override path:** a maintainer applies label `judge-override` → re-run of `checks.yml` treats the judge verdict as advisory (recorded in the check summary and judge log as `overridden-by: <maintainer>`). This is the appeal mechanism; it is also the only human touchpoint in the entire pipeline, and it is exceptional, not routine (D11).

Verdict flapping guard: the judge runs per-push on the diff SHA; identical diff SHA → cached verdict reused (no re-roll for a different verdict).

## 6. Stage 2/3 — eval runs (`smoke.yml`, `full-run.yml`)

### 6.1 Run orchestration (`runner.ts`)

Common sequence for both run types:

1. Acquire concurrency slot (GitHub Actions `concurrency` groups: smoke keyed per-author, full keyed org-wide with max 1; queued not cancelled).
2. Check author monthly budget (`budget.ts` sums `results/runs/*.json` ledger dollars for the author this calendar month; over $30 → fail with reason `monthly-budget-exhausted`, smoke-only per D5 — i.e. full runs blocked, smoke still allowed until the smoke spend itself would exceed the remainder).
3. Mint key: `POST /api/v1/keys/` name `pr-<number>-<smoke|full>-<attempt>`, `limit` = cap (D5).
4. Run Harbor with the pi agent adapter (§6.2) — `runner.ts` spawns the `harbor` CLI as a subprocess with `--agent-import-path` pointing at `agent/pi_agent.py` (the Node↔Python boundary, D19) and consumes Harbor's JSON output artifacts. Smoke: 3 sequential trials × 16 tasks (`-i` globs from smoke-subset.md §4), concurrency 4; full: 1 trial × 89 tasks, concurrency 4.
5. Pull the key's generation records (this is the *only* cost source; nothing self-reported).
6. **Validity assertions** (`ledger.ts`): `byok_usage == 0`; every record's model ∈ allowlist and not `:free`; no records timestamped after teardown (post-teardown record → incident flag in the results file + run voided).
7. Delete the key. Schedule a **T+30min re-check** of the key's ledger (via a `workflow_dispatch`d verification job) to catch post-teardown records that landed late.
8. Emit results JSON (§7.1), sign, push to `results/runs/` on main via `RESULTS_BOT_TOKEN`.
9. Smoke only: gate = median pass count ≥ `smoke.gate` (`TBD(probe)`); pass → `full-run.yml` dispatched automatically (D6).

### 6.2 pi ↔ Harbor agent adapter (`agent/pi_agent.py`) — the load-bearing new component

Harbor drives agents against task containers. The adapter implements Harbor's installed-agent interface. **This is the one Python component in the system (D19)** — Harbor imports it in-process via `--agent-import-path`, which is the only place the Python requirement is real. It must stay self-contained (no imports from `pipeline/`); everything it needs (pi version, checksum, submission path, key, proxy env) arrives via CLI args/env set by `runner.ts`.

- **Install step:** copy vendored pi (`vendor/pi/`, exact version from `competition.toml`) + the submission dir into the task container; install pi from the vendored source only (no network fetch of pi itself); place submission files at pi's config path; verify integrity (checksum of vendored tree matches `competition.toml` `pi.sha256`).
- **Run step:** invoke pi with the task instruction in non-interactive mode, env: `OPENROUTER_API_KEY` (the per-run key — injected **only** here, never into the workflow env at large), `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` per §6.4.
- Timeouts come from the task's own `task.toml` (pinned Verified images) — the adapter does not override them.
- The adapter is also what the participant kit uses locally, so local and CI runs are bit-identical except for the key and the proxy.

### 6.3 Eval box (D9)

One dedicated bare-metal box (Hetzner AX52-class: 16 cores / 64 GB / NVMe). Provisioning documented + scripted in `infra/`:

- Docker, GitHub Actions self-hosted runner (labels: `eval`), registered to the repo, jobs from `smoke.yml`/`full-run.yml` only.
- Persistent Docker image cache (the 89 pinned Verified images ≈ warm after first pull; pre-pull script in `infra/`).
- Sizing: TB tasks are 1 CPU/2 GB; concurrency 4 + harness + proxy fits with headroom; a future Harness-Bench tier (offline Docker tasks, no GPU) runs on the same box unchanged.
- Single point of failure is accepted for v1; a second box is a scaling decision, not a design change.

### 6.4 Egress control (D18)

- All task containers run on an **internal-only Docker network** (`internal: true` — no direct route out).
- A **squid proxy** container straddles internal + egress networks. Allowlist by CONNECT hostname: `openrouter.ai`, plus package registries the pinned Verified images legitimately need — seeded list: `pypi.org`, `files.pythonhosted.org`, `registry.npmjs.org`, `deb.debian.org`, `security.debian.org`, `archive.ubuntu.com`, `security.ubuntu.com`, `crates.io`, `static.crates.io`, `proxy.golang.org`, `github.com`/`codeload.github.com`/`objects.githubusercontent.com` (task setup fetches). **WP7 must empirically derive the final list** by running the full 89 against a log-only proxy and diffing observed CONNECT hosts against this seed.
- Proxy access logs are archived per run (forensics for incident review; retained 90 days on the box).
- Anthropic API is *not* on the allowlist — the judge never runs inside eval.
- Known gap, accepted for v1: a harness that ignores proxy env vars gets no connectivity at all (internal network has no route out), so "ignore the proxy" fails closed, not open. A firewall backstop is unnecessary under this topology; document this reasoning in `infra/runner-setup.md`.

### 6.5 Participant kit (`kit/`)

Node CLI (`arena` entrypoint), thin wrapper over `pipeline/src` (D19); local eval runs require Python + `uv` only for Harbor and `agent/pi_agent.py`, same boundary as CI:

- `arena init` — scaffold `submissions/<login>/` from `_template/`, validate login via `gh auth status`.
- `arena check` — run §5.1 static checks locally (path/manifest/tripwire; judge not included — it's org-funded, but the prompt is public so authors can self-assess).
- `arena smoke [--trials N]` — run the smoke set locally with the participant's own key (default 3 trials, `--trials 1` for cheap iteration); prints pass vector, median pass count, billed dollars per trial pulled from the participant's own generation records.
- `arena verify-pi` — confirm the local vendored pi checksum matches `competition.toml`.

Kit CLI additions required by the skill (§6.6): `arena smoke` must support `--trials 1`, `--tasks <subset>` (iterate on the tasks currently failing/expensive), and `--out <dir>` writing machine-readable artifacts per trial: per-task pass/fail, per-task billed dollars and token breakdown (input/output/cache-read, from the participant's own generation records), and pi transcript paths. `arena report` renders the latest artifacts as a cost/pass table with deltas vs the previous run.

### 6.6 Improvement-loop skill (`kit/skill/SKILL.md`) — one-pager (D21/D22)

Dev tooling in the kit, not part of the submission: nothing in it ships inside `submissions/<login>/`, it never runs in CI, and it enforces and scores nothing. The load-bearing part is the kit CLI above (`--trials 1`, `--tasks`, `--out`, `arena report`); the skill itself is a **single-page agent-agnostic playbook** — standard `SKILL.md` format, only hard dependencies are the `arena` CLI and a shell, no host-specific tool references — describing the loop:

1. **Analyze (free):** read the last run's `--out` artifacts and pi transcripts for cost sinks and repeated failures (cache misses, bloated context, redundant turns).
2. **Edit:** one change at a time, inside `submissions/<login>/` only, never `vendor/pi/`; run `arena check` after each edit.
3. **Cheap trial (~$1–3):** `arena smoke --trials 1` (scope with `--tasks`) to judge direction — single trials are noisy, don't declare victory on one.
4. **Confirm:** median-of-3 smoke for any change worth keeping; that's the number comparable to the CI gate.

Plus two inline warnings: the task-agnosticity rule (judge prompt is public at `judge/prompts/v1.md`; `suspicious` blocks), and a reminder to note per-trial spend from the participant's own generation records. **Deferred until demand exists:** autonomy budgets, convergence detection, trajectory reporting — do not build these in v1.

---

## 7. Results, leaderboard, UI

### 7.1 Per-run results file — `results/runs/<run-id>.json`

`run-id` = `pr<number>-<smoke|full>-a<attempt>` (matches key name). Schema (source of truth: `results.ts` types; JSON Schema exported to `results/schema/run.schema.json`):

```jsonc
{
  "schema_version": 1,
  "run_id": "pr42-full-a1",
  "run_type": "full",                    // "smoke" | "full" | "baseline"
  "pr": 42,
  "author": "somelogin",
  "entry_name": "my-cheap-harness",
  "submission_sha": "<merge-ref sha>",
  "pi_version": "<from competition.toml>",
  "config_sha": "<sha of competition.toml used>",
  "started_at": "...", "finished_at": "...",
  "trials": [                            // 1 entry for full, 3 for smoke
    { "pass_vector": {"fix-git": true, "...": false},
      "pass_count": 61,
      "billed_usd": 4.9123,              // sum of generation records
      "generation_ids": ["gen-..."],     // full audit trail
      "cache_read_tokens": 0, "input_tokens": 0, "output_tokens": 0 }
  ],
  "median_pass_count": 61,               // = trials[0] for full
  "median_billed_usd": 4.9123,
  "openrouter_key_name": "pr42-full-a1",
  "validity": { "byok_zero": true, "models_allowlisted": true,
                "post_teardown_records": false, "voided": false,
                "void_reason": null },
  "anomaly_flags": []                    // e.g. "task write-compressor passed at 3.1k tokens"
}
```

Signed with minisign (detached `.minisig`), committed by the results bot. The generation IDs make every dollar independently auditable against OpenRouter.

### 7.2 Leaderboard — `results/leaderboard.json`

Regenerated by `results.ts` after every full run (and on demand):

- Consider only `run_type == "full"`, `validity.voided == false`, submission merged or PR open (both shown; merged flagged).
- **Eligible** = `median_pass_count ≥ full.eligibility_bar` (`TBD(probe)`, D16).
- One row per author: their **lowest-cost eligible run**. Rank ascending by `median_billed_usd`. Ineligible best-runs shown in a separate "below bar" section (with pass count) so near-misses are visible.
- Baseline row pinned (from the `run_type: "baseline"` probe results file).
- Season finalization/prizes: out of scope (D17) — the JSON is append-only history, so any future season rule can be computed retroactively.

### 7.3 Web UI (`web/`)

Carried over (D7). Changes: delete router/attestation-era views; leaderboard page reads `results/leaderboard.json` (raw.githubusercontent or bundled at deploy); run-detail page renders a `results/runs/*.json` (pass vector grid, cost breakdown, validity panel, anomaly flags); GitHub OAuth identity kept as-is for any authored actions. No new backend (D15).

---

## 8. `competition.toml` — single config source

```toml
[competition]
season = 0

[pi]
version = "<latest at implementation time — WP1 records it>"
sha256 = "<checksum of vendor/pi tree>"

[benchmark]
dataset = "terminal-bench/terminal-bench-2"
image_tag = "20260204"                  # xiangyangli/<task>:20260204
concurrency = 4

[models]
allowlist = ["xiaomi/mimo-v2.5", "deepseek/deepseek-v4-flash",
  "minimax/minimax-m3", "z-ai/glm-5.2", "deepseek/deepseek-v4-pro",
  "stepfun/step-3.7-flash", "xiaomi/mimo-v2.5-pro", "openai/gpt-oss-120b"]
ban_free_variants = true
baseline_model = "z-ai/glm-5.2"

[smoke]
tasks = ["fix-git", "git-leak-recovery", "pypi-server", "kv-store-grpc",
  "write-compressor", "nginx-request-logging", "configure-git-webserver",
  "modernize-scientific-stack", "sanitize-git-repo", "password-recovery",
  "query-optimize", "custom-memory-heap-crash", "db-wal-recovery",
  "model-extraction-relu-logits", "regex-log", "pytorch-model-cli"]
trials = 3
gate = -1                               # TBD(probe): frozen absolute pass count
cap_usd = 1.50
runs_per_pr_per_day = 2

[full]
trials = 1
eligibility_bar = -1                    # TBD(probe): frozen absolute pass count
cap_usd = 10.00
runs_per_pr_per_day = 1
org_concurrency = 1

[budget]
author_monthly_usd = 30.00

[judge]
model = "claude-sonnet-4-6"
prompt = "judge/prompts/v1.md"

[submission]
max_bytes = 1048576
max_files = 200
```

`config.ts` refuses to start official runs while any `TBD(probe)` sentinel (`-1`) remains — except `run_type: "baseline"` runs, which are exactly how those numbers get filled.

---

## 9. Threat → mitigation matrix (spec-level summary)

| # | Threat | Mitigation (section) |
|---|--------|----------------------|
| T1 | Runaway/malicious spend | per-run capped keys, deleted post-run (§6.1); monthly author budget (§6.1.2); concurrency + per-day limits (§6.1.1) |
| T2 | Key exfiltration | cap + deletion + T+30min ledger re-check (§6.1.7); key only in harness container (§6.2) |
| T3 | Solution embedding | tripwire (§5.1.3) + judge blocks suspicious/violation (§5.3) + anomaly flags (§7.1) |
| T4 | Offloading inference to free endpoints | egress proxy allowlist, fail-closed internal network (§6.4) |
| T5 | BYOK / off-ledger inference | `byok_usage == 0` assertion; allowlist check on every generation record (§6.1.6) |
| T6 | Tampering with pi/pipeline/results | path-containment check (§5.1.1); vendored pi checksum at run time (§6.2); signed results (§7.1) |
| T7 | Sockpuppet run-farming | accepted residual risk under D11 (fully-auto): bounded to $1.50 × 2/day × accounts by caps; judge log + admin label filter for detection; revisit with D6 |
| T8 | CI as free compute | egress allowlist kills mining/proxying; task timeouts from pinned images; no GPUs |

## 10. Work packages (implementation handoff)

Sized for one implementation agent each; dependencies noted. Every WP includes tests and doc updates for what it touches. Acceptance criteria are the definition of done.

| WP | Title | Depends on | Deliverables | Acceptance criteria |
|----|-------|-----------|--------------|---------------------|
| 1 | **Repo pivot & scaffolding** | — | Teardown per §2 with **Node-glue salvage** (existing tested HTTP/JSON/git helpers + tests move into `pipeline/`; router/grader/attestation logic deleted, dead-code grep clean); new layout; `competition.toml`; `vendor/pi/` at current latest release with `pi.version`/`pi.sha256` recorded; `pipeline/` package skeleton + `config.ts` | repo builds/tests green post-teardown; salvaged glue's existing tests still pass in new location; config loader round-trips §8 incl. TBD sentinels; `vendor/pi` checksum verifies |
| 2 | **pi ↔ Harbor agent adapter** | 1 | `agent/pi_agent.py` per §6.2 (self-contained; no `pipeline/` imports) | vanilla pi completes ≥1 real TB task end-to-end via Harbor locally (echo/dry-run mode for CI tests); submission dir mounts at pi's config path; checksum gate works; key + proxy env injected only into task container; all inputs arrive via args/env from `runner.ts` |
| 3 | **Keys, ledger, budget** | 1 | `keys.ts`, `ledger.ts`, `budget.ts` per §6.1 | against the real Provisioning API (test management key): mint→limit→delete lifecycle; generation pull with cache telemetry; all §6.1.6 validity assertions unit-tested incl. void paths; monthly budget sums from fixture results files |
| 4 | **Static checks + tripwire** | 1 | `checks.ts` per §5.1; `tripwire.txt` seeded from TB task names + solution strings | path-containment catches `vendor/` and cross-author edits with distinct reasons; manifest/size validation; tripwire catches plain, base64, and hex forms in fixture diffs |
| 5 | **LLM judge** | 1 | `judge.ts`, `judge/prompts/v1.md`, all four §5.3 surfacing outputs, override label handling, SHA-keyed verdict cache | fixture diffs (clean config / obvious embedding / disguised-encoded embedding) get correct verdicts; sticky comment updates in place; override recorded in check summary + judge log |
| 6 | **CI workflows** | 2,3,4,5 | `checks.yml`, `smoke.yml`, `full-run.yml` per §1/§5/§6; concurrency groups; auto full-run dispatch; T+30min ledger re-check job | fork-PR secret isolation verified (judge reads diff via API only, never checks out PR code under `pull_request_target`); smoke→full auto-trigger fires only on gate pass; per-day + concurrency limits enforced |
| 7 | **Eval box + egress proxy** | — (parallel) | `infra/`: provisioning script/doc, runner registration, squid config + internal-network compose, image pre-pull, log retention | box runs a smoke workload end-to-end; direct egress from a task container fails closed; allowed domains work via proxy; **final registry allowlist derived empirically** (log-only run over all 89 → diff vs seed list); per-run proxy logs archived |
| 8 | **Results + leaderboard generation** | 3 | `results.ts` per §7.1–7.2; JSON Schema export; minisign signing; results-bot commit flow; `leaderboard.yml` | fixture runs → valid signed JSON (schema-validated); leaderboard math correct incl. eligibility bar, per-author best, below-bar section, baseline pin; append-only (never rewrites existing run files) |
| 9 | **Web UI rewire** | 8 | `web/` per §7.3 | leaderboard + run-detail render from fixture `results/` JSON; router/attestation views removed; OAuth flow still works |
| 10 | **Participant kit** | 2,3,4 | `kit/` CLI per §6.5 incl. `--tasks`/`--out` artifacts and `arena report`; participant-facing README/quickstart | `init`/`check`/`verify-pi` work offline; `smoke --trials 1` completes against a real key and reports billed dollars from the participant's own ledger; `--out` artifacts schema-stable and consumed by `arena report`; quickstart takes a new participant from clone → local smoke result |
| 11 | **Baseline probe + config freeze** | 2,3,7,8 | probe runner mode (`run_type: "baseline"`, cap-exempt, manual dispatch); freeze procedure doc | probe produces a baseline results file; documented one-PR procedure fills `smoke.gate` + `full.eligibility_bar` and recalibrates D5 caps; config loader then accepts official runs |
| 12 | **Improvement-loop skill one-pager** | 10 | `kit/skill/SKILL.md` per §6.6 — one page, agent-agnostic | loaded into ≥2 different agents (e.g. Claude Code + pi) it drives one analyze → edit → cheap-trial → confirm cycle against a scratch submission using only the `arena` CLI; stays inside `submissions/<login>/`; no autonomy/convergence machinery present |

Suggested build order: WP1 → {WP2, WP3, WP4, WP5, WP7 in parallel} → WP6 → {WP8, WP10} → WP9 → {WP11, WP12} (WP11 also blocks on the org's OpenRouter credit refresh).

## 11. Out of scope / deferred

- Season finalization, prizes, end-of-season audit mechanics (D17).
- Cheaper local-iteration micro-tier (explicitly punted earlier).
- Harness-Bench secondary tier (possible future; runs on the same infra per D9 — would need a pi adapter for HB and a scoring policy decision, since HB uses an LLM judge for verification).
- Full-run trigger revisit (D6 needs-more-thought), sockpuppet posture revisit (T7) — both after first weeks of real traffic.
- Incident playbook (voided runs, post-teardown records → disqualification tiers, appeal path) — draft before season 0 opens, not needed to build.
- Improvement-loop skill autonomy machinery — budgets, convergence detection, trajectory reporting (D22) — revisit if participants ask for it.

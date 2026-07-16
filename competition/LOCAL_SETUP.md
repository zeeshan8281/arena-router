# Local harness setup (v2 unblock)

Gets `harbor` + `pi` running locally so the runner (§6.1) and participant kit
(§6.5) can be built against a real interface instead of docs. Verified 2026-07-16.

## TL;DR of what unblocked it

- **`badlogic/pi-terminal-bench`** already implements the pi↔Harbor adapter the
  spec (§6.2) treats as an unbuilt "load-bearing new component". It passes
  `OPENROUTER_API_KEY` through and parses `provider/model`, so
  `-m openrouter/z-ai/glm-5.2` works with **no changes**. Fork + pin, don't rebuild.
- Harbor's agent API was rewritten after the adapter's last commit (2025-12-01).
  Latest harbor (`0.18.0`) removed `ExecInput` → adapter import fails. **Pin
  `harbor==0.1.18`** (latest of the compatible `0.1.x` line) in the adapter venv.

## Install (reproducible)

```bash
# harbor CLI (global, for oracle/inspection) — Python
uv tool install harbor            # -> harbor 0.18.0, bins: harbor/hb/hr

# pi coding agent — Node/npm. Global dir is root-owned here, so use a user prefix:
npm config set prefix ~/.local
npm install -g @earendil-works/pi-coding-agent   # -> pi 0.74.2 at ~/.local/bin/pi
# NB: the adapter installs @mariozechner/pi-coding-agent *inside the task
# container* via nvm+node22 (install-pi.sh.j2). Same agent; container has its own.

# adapter + a COMPATIBLE harbor, in an isolated venv
mkdir -p ~/workspaces && cd ~/workspaces
git clone https://github.com/badlogic/pi-terminal-bench && cd pi-terminal-bench
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
uv pip install 'harbor==0.1.18'   # <-- override the unpinned harbor>=0.1.0
python -c "from pi_terminal_bench import PiAgent; print(PiAgent.name())"  # -> pi
```

Requires Docker running (have 29.2.0).

**Verified end-to-end:** `harbor run -d terminal-bench@2.0 -t fix-git -a oracle`
→ Mean reward 1.000, 0 errors, ~77s. Proves harbor→Docker→verifier works locally
(no API key needed for oracle).

### Required Harbor patch (from adapter README)
`upload_dir` copies the dir instead of its contents when target exists → verifier
files land at `/tests/tests/…` and every task fails. Apply the one-liner patch in
the adapter README (`rstrip('/') + '/.'`) before any real run.

## Run interface (harbor 0.1.18 — differs from spec's `-i` globs)

```bash
source ~/workspaces/pi-terminal-bench/.venv/bin/activate
# key-free end-to-end validation (reference solution + verifier):
harbor run -d terminal-bench@2.0 -t <task> -a oracle -n 1 -o ./out
# pi against a model:
harbor run -d terminal-bench@2.0 -t <task> \
  --agent-import-path pi_terminal_bench:PiAgent \
  -m openrouter/z-ai/glm-5.2 -n 1 -o ./out
```

Flag deltas vs `docs/smoke-subset.md` §4 (which assumes a newer/other harbor):
- task selection: `-t/--task-name` (repeatable), **not** `-i` globs / `--task-ids`.
- `-o/--jobs-dir` for output; `-n/--n-concurrent`.
- Re-check flags if we bump harbor off 0.1.18.

## Still blocked
- **OpenRouter key** — needed for any pi run, the baseline probe, and to
  live-validate `scoring/openrouter.mjs` response shapes. Oracle needs no key.
- Cost source: adapter self-reports cost from pi's JSON; the competition scores
  **OpenRouter billed generation records** instead (`scoring/openrouter.mjs`), so
  we don't depend on the adapter's number.

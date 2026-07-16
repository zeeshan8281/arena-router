# agent/ — pi ↔ Harbor adapter (WP2, spec §6.2)

The single Python component (D19). Harbor loads it in-process:

```bash
harbor run -d terminal-bench@2.0 -t <task> \
  --agent-import-path pi_agent:PiAgent \
  -m openrouter/z-ai/glm-5.2 -n 1
```

`runner.ts` sets the env the adapter reads: `OPENROUTER_API_KEY` (per-run capped key),
`PI_VENDOR_TARBALL` + `PI_VENDOR_SHA256` (vendored pi, D20), optional `PI_AGENT_ECHO=1`
(dry run). See the module docstring in `pi_agent.py`.

## What differs from the upstream adapter
Forked from `badlogic/pi-terminal-bench`. Substantive change = **D20**: pi is installed
from the vendored tarball only (`install-pi.sh.j2` → `npm install -g /installed-agent/pi.tgz`),
never fetched from the npm registry, and `setup()` checksum-gates the tarball before upload.
Plus an echo mode so CI can exercise the harness plumbing without a key.

## Validated
- **Offline (`pytest test_pi_agent.py`, 6 tests):** model parsing, run-command shape,
  provider-key passthrough, echo switch, D20 install-template content, checksum gate.
- **Live, key-free:** `harbor run ... -a oracle` passes end-to-end (reward 1.0 on `fix-git`),
  proving harbor→Docker→verifier. See `competition/LOCAL_SETUP.md`.

## Not yet validated (needs a key and/or WP1)
- The pi run path against a real model → needs `OPENROUTER_API_KEY` (baseline probe).
- `setup()` tarball upload + in-container install → needs WP1 to vendor pi into
  `vendor/pi/` (as `pi.tgz`) and record `pi.sha256` in `competition.toml`, plus one live
  Docker run. Apply the Harbor `upload_dir` patch first (LOCAL_SETUP.md).

## Harbor pin
`harbor==0.1.18` (pyproject). harbor ≥0.18 rewrote `BaseInstalledAgent` (no `ExecInput` /
`create_run_agent_commands`) — bumping means porting to the new `CliFlag`/`EnvVar` API.

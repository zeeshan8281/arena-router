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
The gate is **fail-closed** (SEC C2b): a missing/blank `PI_VENDOR_TARBALL` or
`PI_VENDOR_SHA256` raises and refuses to install, and `install-pi.sh.j2` re-verifies the
sha256 (`sha256sum -c`) before `npm install` (defense in depth). Plus an echo mode so CI
can exercise the harness plumbing without a key.

## Validated
- **Offline (`pytest test_pi_agent.py`, 7 tests):** model parsing, run-command shape,
  provider-key passthrough, echo switch, D20 install-template content, the fail-closed
  checksum gate, and the install-template sha256 verification.
- **Live, key-free (oracle):** `harbor run ... -a oracle` passes end-to-end (reward 1.0 on
  `fix-git`), proving harbor→Docker→verifier. See `competition/LOCAL_SETUP.md`.
- **Live, key-free (D20 install path):** echo-mode run against `fix-git` with the vendored
  tarball — `setup()` uploaded `vendor/pi/pi.tgz`, checksum passed, in-container
  `npm install -g /installed-agent/pi.tgz` succeeded ("added 127 packages", `pi --help` OK),
  Errors = 0. The whole install+run+verify plumbing works from vendored source only.

## Not yet validated (needs a key)
- The pi run path against a real model → needs `OPENROUTER_API_KEY` (baseline probe).
  Everything up to the model call is proven; this is the one remaining gap.

## Harbor pin
`harbor==0.1.18` (pyproject). harbor ≥0.18 rewrote `BaseInstalledAgent` (no `ExecInput` /
`create_run_agent_commands`) — bumping means porting to the new `CliFlag`/`EnvVar` API.

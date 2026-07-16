# Eval-box provisioning runbook (impl-spec §6.3 / §6.4)

Provisioning + operation of the single dedicated eval box for AutoRouter Arena
v2. Everything here is scripted where practical; this doc is the authoritative
sequence. One box runs both the smoke gate and the full 89-task benchmark.

## 1. Box

- **Class:** Hetzner AX52 or equivalent bare metal.
- **Specs:** 16 cores / 64 GB RAM / NVMe.
- **Sizing rationale (§6.3):** TB tasks are ~1 CPU / 2 GB each; Harbor runs
  concurrency 4, plus the runner + squid. That fits inside 16c/64G with
  headroom. A future Harness-Bench tier (offline Docker tasks, no GPU) runs on
  the same box with no infra change.
- **Single point of failure is accepted for v1.** A second box is a scaling
  decision, not a design change — do not build HA plumbing now.
- **OS:** current Ubuntu LTS.

## 2. Base install

```bash
# Docker Engine + compose plugin (official repo)
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker

# Unattended security updates; NTP for accurate proxy-log timestamps
sudo apt-get install -y unattended-upgrades chrony
```

Do NOT install a host firewall as an egress backstop — see §6, it is
deliberately unnecessary under this topology.

## 3. GitHub Actions self-hosted runner

The runner and squid come up together via `docker compose` (see
`docker-compose.yml`). It is registered **to the repo**, not the org.

- **Label:** `eval` (only). `smoke.yml` and `full-run.yml` target
  `runs-on: [self-hosted, eval]`; **no other workflow may land here.** The
  static/judge `checks.yml` and `leaderboard.yml` run on GitHub-hosted runners
  — keep them off this box.
- **Ephemeral:** the runner is configured ephemeral so each job starts from a
  clean runner and cannot inherit state from a prior run.
- **Secrets:** provided by the `eval-runner` GitHub environment
  (`OPENROUTER_MANAGEMENT_KEY`, `ANTHROPIC_API_KEY`, `RESULTS_BOT_TOKEN` per §3). They are injected by Actions at job time — do NOT
  bake them into the box image or compose env.

Bring-up:

```bash
export GH_REPO_URL="https://github.com/<org>/<repo>"
export GH_RUNNER_TOKEN="<short-lived registration token>"   # Settings → Actions → Runners → New
docker compose -f infra/docker-compose.yml up -d
```

Confirm the runner shows up under Settings → Actions → Runners with the `eval`
label and is idle.

## 4. Persistent Docker image cache + pre-pull of the 89 pinned images

The 89 pinned Verified images are large; pulling them per run is wasteful. The
host Docker daemon's image store on NVMe IS the persistent cache — once warm,
Harbor's task-container starts are near-instant (§6.3). Warm it once at
provisioning (and again whenever `competition.toml`'s `image_tag` bumps).

- **Images:** `xiangyangli/<task>:20260204` — one per task, tag pinned to the TB
  2.0 Verified / 2.1 set (`competition.toml`: `dataset =
  "terminal-bench/terminal-bench-2"`, `image_tag = "20260204"`).
- **Task list source:** the 89 task names come from the **terminal-bench-2
  registry** (the dataset manifest), NOT a list hardcoded here — pulling the
  list from the registry keeps it in lockstep with the pinned dataset.

Pre-pull loop (`infra/prepull-images.sh` — create alongside this doc):

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-20260204}"        # keep in sync with competition.toml
IMAGE_REPO="xiangyangli"

# Derive the 89 task names from the terminal-bench-2 registry rather than
# hardcoding. Adjust the extraction to the registry's actual manifest shape;
# the CONTRACT is: emit exactly the 89 Verified task slugs, one per line.
tasks="$(tb tasks list --dataset terminal-bench/terminal-bench-2 --names-only)"

count=0
while IFS= read -r task; do
  [ -z "$task" ] && continue
  img="${IMAGE_REPO}/${task}:${IMAGE_TAG}"
  echo "==> pulling ${img}"
  docker pull "$img"
  count=$((count + 1))
done <<< "$tasks"

echo "warmed ${count} images (expected 89)"
[ "$count" -eq 89 ] || { echo "WARNING: expected 89, got ${count}"; exit 1; }
```

The loop is idempotent — re-running only pulls changed layers. Run it after
first provisioning and after any `image_tag` bump. The cache survives across
runs because it lives in the host daemon, not in ephemeral runner work dirs.

**Node runtime in task images (SEC M7).** `agent/install-pi.sh.j2` installs a
Node runtime at task-setup time by fetching nvm from `raw.githubusercontent.com`
and the Node tarball from `nodejs.org`. Those two hosts are allowlisted in
`squid.conf` **as install-time-only** so the install path works behind the
enforcing proxy. **Preferred:** pre-bake Node 22 into the pinned eval images so
the runtime `curl … | bash` drops off the critical path entirely — then the
install script only runs `npm install -g /installed-agent/pi.tgz` (whose deps
come from `registry.npmjs.org`) and the nvm/nodejs.org allowlist entries can be
removed. Track this with the `image_tag` bump procedure below.

## 5. squid proxy

squid comes up as part of `docker compose up -d` (§3). It is the sole egress
path off the internal-only task network (§6.4).

- Config: `infra/squid/squid.conf` (CONNECT-hostname allowlist; seed list per
  §6.4, WP7 finalizes it via a log-only run over all 89 tasks).
- Verify config before/after edits: `docker exec arena-squid squid -k parse`.
- Reload after an allowlist change (no restart needed):
  `docker exec arena-squid squid -k reconfigure`.
- Sanity check the fail-closed default from inside the internal network:
  an allowlisted host (`openrouter.ai:443`) should CONNECT; a non-listed host
  (`api.anthropic.com:443`, `example.com:443`) should be denied.

### Proxy-log retention — 90 days (§6.4)

Access logs are archived per run for incident forensics and retained **90 days**
on the box. Logs land on the host bind-mount `/var/log/arena-squid` (mounted
into squid at `/var/log/squid`). Enforce retention with host logrotate:

```
# /etc/logrotate.d/arena-squid
/var/log/arena-squid/access.log {
    daily
    rotate 90
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

`copytruncate` lets squid keep writing without a reopen signal. `rotate 90` +
`daily` gives the 90-day window. Rotated logs stay on the NVMe; pull them for
incident review as needed.

## 6. Egress model — why this fails closed (§6.4)

The security property is topological, not enforced by a firewall:

- Task containers run on an **internal-only Docker network**
  (`internal: true`) that has **no route out**. Their only reachable off-box
  peer is squid (the dual-homed proxy).
- **The runner itself is on the same internal-only network (SEC C2c).** It is
  NOT on the egress bridge. It holds the key-minting `OPENROUTER_MANAGEMENT_KEY`
  and `RESULTS_BOT_TOKEN` and runs `runner.mjs` from the PR merge ref, so it is
  attacker-influenced; giving it an unrestricted bridge would let a compromised
  runner exfiltrate those secrets to any host and bypass the squid allowlist
  entirely. Instead it egresses ONLY through squid via
  `HTTP(S)_PROXY=http://squid:3128` (set in `docker-compose.yml`), with
  `NO_PROXY` covering loopback/squid/the Docker socket. github.com and the
  Actions control-plane hosts are allowlisted (see `squid.conf`), so
  registration, job polling, and log streaming still work.
- squid forwards **only** allowlisted CONNECT hosts and denies everything else
  (`http_access deny all`).
- Therefore a harness that **ignores the proxy env vars gets no connectivity at
  all** — with no proxy and no route, its packets go nowhere. "Ignore the
  proxy" **fails closed**, not open. There is nothing to leak to.
- **No firewall backstop is needed** under this topology, and we deliberately
  don't add one: the internal network already denies-by-default at the routing
  layer, and the proxy denies-by-default at the application layer. A firewall
  would be redundant belt-and-suspenders with no failure mode it uniquely
  covers. (This is the §6.4 "known gap, accepted for v1" reasoning, written out
  here as required.)
- **Anthropic is not on the allowlist.** The judge never runs inside eval — it
  only reads the PR diff via the GitHub API in a separate `pull_request_target`
  job (§3). Inference inside eval is OpenRouter-only.

### Defense-in-depth, not the primary RCE control (SEC C2c / M6)

The network lockdown above is a **backstop**. The primary control against a
malicious submission exfiltrating the management key is architectural and lives
outside this box:

- **Runner should not execute untrusted PR code with secrets in scope.** The
  smoke/full jobs currently check out `refs/pull/<n>/merge` (the full merged
  tree, including the PR's copy of `competition/runner.mjs`) on a runner that
  holds `OPENROUTER_MANAGEMENT_KEY`. The robust design is for `runner.mjs` to run
  from a **trusted base checkout** and overlay ONLY `submissions/<author>/` from
  the PR — never executing PR-authored harness/tooling. **Cross-file dependency
  (runner agent):** implement the base-checkout + submission-overlay in
  `competition/runner.mjs` and adjust `smoke.yml`/`full-run.yml` to check out the
  base ref for tooling and fetch only the submission dir. Until that lands, the
  squid egress cap is the mitigation that keeps a compromised runner from
  reaching arbitrary hosts.
- **Key scope + isolation (SEC M6).** `openrouter.ai` also serves the
  key-provisioning API (`/api/v1/keys`), and CONNECT-hostname allowlisting cannot
  separate inference from key-minting (the path is inside the TLS tunnel). So the
  controls that actually matter are: the per-run `OPENROUTER_API_KEY` injected
  into task containers is a **capped inference key with no provisioning scope**,
  and the `OPENROUTER_MANAGEMENT_KEY` is held **only by `runner.mjs` in the
  trusted runner step** and is **never** injected into a task container. Confirm
  both invariants in `runner.mjs`. See the loud comment on the `openrouter.ai`
  line in `squid.conf`.

## 7. Operational notes

- **WP7 allowlist finalization:** before locking the allowlist, run the full 89
  against a log-only proxy (comment out squid's final `http_access deny all` or
  temporarily `http_access allow CONNECT`, keep logging on) and diff observed
  CONNECT hosts against the §6.4 seed. Add only legitimate observed hosts.
- **Bump procedure (image_tag change):** update `competition.toml`, re-run
  `prepull-images.sh`, re-run the WP7 log-only diff (new images may fetch new
  hosts).
- **Recovery:** the box is stateless apart from the image cache and proxy logs.
  On rebuild, re-run §2–§5; re-pulling images restores the cache.

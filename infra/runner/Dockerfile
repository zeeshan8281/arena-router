# Eval-box runner image (runner-setup.md §3a) — myoung34/github-runner with the
# arena eval toolchain baked in, so jobs on the internal-only network need no
# tool downloads at run time:
#   - node 22          : competition/runner.mjs + kit (setup-node would otherwise
#                        fetch through squid every job)
#   - python 3.12 venv : harbor==0.1.18 (pinned — 0.18 rewrote the agent API;
#                        see agent/pyproject.toml) with two build-time patches
#                        applied by patch-harbor.py (fail-closed):
#                          1. upload_dir docker-cp fix (verifier /tests/tests bug)
#                          2. compose templates -> arena-internal net + squid proxy
#
# Build from the REPO ROOT (paths below are repo-relative):
#   docker build -f infra/runner/Dockerfile -t arena-eval-runner:<tag> .
# Pin the resulting digest in infra/docker-compose.yml.
FROM myoung34/github-runner:ubuntu-noble

# Node 22 (NodeSource) — jammy/noble ship older node
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Python 3.12 venv with pinned harbor. noble's python3 IS 3.12; use it directly.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/harbor-venv \
    && /opt/harbor-venv/bin/pip install --no-cache-dir "harbor==0.1.18"

# Apply the two harbor patches (fails the build if harbor's files aren't the
# pristine 0.1.18 ones — version drift must be handled deliberately).
COPY infra/runner/patch-harbor.py /opt/arena/patch-harbor.py
COPY infra/runner/compose-templates/ /opt/arena/compose-templates/
RUN /opt/harbor-venv/bin/python /opt/arena/patch-harbor.py

# harbor on PATH for runner.mjs / kit (spawnSync("harbor", ...)).
ENV PATH="/opt/harbor-venv/bin:${PATH}"
# Task containers join the internal-only network (compose template default,
# overridable for local dev without the squid topology).
ENV HARBOR_TASK_NETWORK=arena-internal

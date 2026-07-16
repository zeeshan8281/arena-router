#!/usr/bin/env bash
# prepull-images.sh — warm the host Docker image cache with the 89 pinned TB-2
# task images (runner-setup.md §4).
#
# GROUND TRUTH: the image each task uses is the `docker_image` in its task.toml
# at the git commit the harbor registry pins for `terminal-bench@2.0`. Harbor
# pulls exactly those refs at run time, so we pre-pull exactly those refs —
# derived live, never hardcoded. (As of registry commit 69671fba these are
# `alexgshaw/<task>:20251031`; competition.toml's `image_tag`/`xiangyangli`
# aspiration needs a registry override that does not exist yet — see
# runner-setup.md §4.)
#
# Idempotent: `docker pull` of a cached image only fetches changed layers.
# Cross-checked against competition/anti-abuse/task-ids.txt when run from the
# repo (count + task-name diff must both be clean).
set -euo pipefail

REGISTRY_URL="${REGISTRY_URL:-https://raw.githubusercontent.com/laude-institute/harbor/main/registry.json}"
DATASET_NAME="${DATASET_NAME:-terminal-bench}"
DATASET_VERSION="${DATASET_VERSION:-2.0}"
EXPECTED_COUNT=89

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
task_ids_file="${repo_root}/competition/anti-abuse/task-ids.txt"

# Emit "task-name docker-image" lines from the registry-pinned task.tomls.
# (while-read, not mapfile — must also run under macOS bash 3.2 for local use)
lines=()
while IFS= read -r line; do lines+=("$line"); done < <(python3 - "$REGISTRY_URL" "$DATASET_NAME" "$DATASET_VERSION" <<'PY'
import json, re, sys, urllib.request

registry_url, name, version = sys.argv[1:4]
with urllib.request.urlopen(registry_url) as r:
    registry = json.load(r)

dataset = next(
    (d for d in registry if d.get("name") == name and str(d.get("version")) == version),
    None,
)
if dataset is None:
    sys.exit(f"dataset {name}@{version} not found in {registry_url}")

for task in dataset["tasks"]:
    # git_url like https://github.com/<org>/<repo>.git -> raw.githubusercontent.com
    m = re.match(r"https://github\.com/(.+?)(?:\.git)?$", task["git_url"])
    if not m:
        sys.exit(f"unexpected git_url for {task['name']}: {task['git_url']}")
    raw = f"https://raw.githubusercontent.com/{m.group(1)}/{task['git_commit_id']}/{task['path']}/task.toml"
    with urllib.request.urlopen(raw) as r:
        toml = r.read().decode()
    img = re.search(r'^docker_image\s*=\s*"([^"]+)"', toml, re.M)
    if not img:
        sys.exit(f"no docker_image in task.toml for {task['name']}")
    print(task["name"], img.group(1))
PY
)

count="${#lines[@]}"
echo "==> ${DATASET_NAME}@${DATASET_VERSION}: ${count} tasks (expected ${EXPECTED_COUNT})"
[ "$count" -eq "$EXPECTED_COUNT" ] || { echo "ERROR: expected ${EXPECTED_COUNT} tasks, registry gave ${count}" >&2; exit 1; }

# Cross-check the task names against the repo's pinned ID list, if available.
if [ -f "$task_ids_file" ]; then
  if ! diff <(printf '%s\n' "${lines[@]}" | cut -d' ' -f1 | sort) <(sort "$task_ids_file") >/dev/null; then
    echo "ERROR: registry task names diverge from competition/anti-abuse/task-ids.txt:" >&2
    diff <(printf '%s\n' "${lines[@]}" | cut -d' ' -f1 | sort) <(sort "$task_ids_file") >&2 || true
    exit 1
  fi
  echo "==> task names match ${task_ids_file}"
fi

i=0
for line in "${lines[@]}"; do
  task="${line%% *}"; img="${line#* }"
  i=$((i + 1))
  echo "==> [${i}/${count}] ${task}: pulling ${img}"
  docker pull --quiet "$img"
done

echo "warmed ${count} images"

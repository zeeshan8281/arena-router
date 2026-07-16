#!/usr/bin/env python3
"""Patch harbor 0.1.18 for the eval box (runner-setup.md §3a).

Two patches, both fail-closed (any mismatch = non-zero exit, image build fails):

1. upload_dir `docker cp` semantics (adapter README "Required: Apply Harbor Fix"):
   `docker cp SRC main:DST` copies SRC *as a subdirectory* when DST already
   exists, so a task agent that pre-creates /tests sends verifier files to
   /tests/tests/… and every task fails. Append `/.` to copy contents instead.

2. Task-container network + egress proxy (docker-compose.yml topology, SEC C2c):
   harbor's two compose templates get replaced with copies that attach the task
   container to the external `arena-internal` network (overridable via
   HARBOR_TASK_NETWORK) and pass the standard proxy vars through from the
   harbor process env. Originals are sha256-verified first so a harbor bump
   can't silently ship templates we'd clobber.
"""

import hashlib
import inspect
import shutil
import sys
from pathlib import Path

import harbor.environments.docker.docker as docker_mod

DOCKER_PY = Path(docker_mod.__file__)
TEMPLATE_DIR = DOCKER_PY.parent
PATCHED_TEMPLATE_DIR = Path(__file__).parent / "compose-templates"

# sha256 of the pristine harbor==0.1.18 files (verified from the PyPI wheel).
ORIGINALS = {
    "docker.py": "53839939eed6510826cc5ab9189b60806f0b906a573b79bc3c21f94848b353b0",
    "docker-compose-build.yaml": "9bb8ac899a62ad12d22efb5f1ed1c10d8c9a008517f5c5bb80370d590c17f032",
    "docker-compose-prebuilt.yaml": "a7ade9a13b6c01210d88e847f76bad3f2522e59afee485c09f4d094a9e65272c",
}

UPLOAD_DIR_OLD = '''    async def upload_dir(self, source_dir: Path | str, target_dir: str):
        await self._run_docker_compose_command(
            [
                "cp",
                str(source_dir),
                f"main:{target_dir}",
            ],
            check=True,
        )'''

UPLOAD_DIR_NEW = '''    async def upload_dir(self, source_dir: Path | str, target_dir: str):
        # PATCHED (arena eval box): append /. so `docker cp` copies the
        # directory CONTENTS even when the target already exists.
        source = str(source_dir).rstrip("/") + "/."
        await self._run_docker_compose_command(
            [
                "cp",
                source,
                f"main:{target_dir}",
            ],
            check=True,
        )'''


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    for name, expected in ORIGINALS.items():
        actual = sha256(TEMPLATE_DIR / name)
        if actual != expected:
            sys.exit(
                f"REFUSING: {name} is not pristine harbor 0.1.18 "
                f"(expected {expected}, got {actual}) — harbor version drift? "
                "Re-derive the patches against the installed version."
            )

    # 1. upload_dir fix
    text = DOCKER_PY.read_text()
    if UPLOAD_DIR_OLD not in text:
        sys.exit("REFUSING: upload_dir source did not match the expected block")
    DOCKER_PY.write_text(text.replace(UPLOAD_DIR_OLD, UPLOAD_DIR_NEW))

    # 2. compose templates -> arena-internal + proxy passthrough
    for name in ("docker-compose-build.yaml", "docker-compose-prebuilt.yaml"):
        src = PATCHED_TEMPLATE_DIR / name
        if not src.exists():
            sys.exit(f"REFUSING: patched template missing: {src}")
        shutil.copyfile(src, TEMPLATE_DIR / name)

    # verify
    import importlib

    importlib.reload(docker_mod)
    src = inspect.getsource(docker_mod.DockerEnvironment.upload_dir)
    assert 'rstrip("/")' in src, "upload_dir patch did not take"
    for name in ("docker-compose-build.yaml", "docker-compose-prebuilt.yaml"):
        t = (TEMPLATE_DIR / name).read_text()
        assert "arena-internal" in t and "HTTP_PROXY" in t, f"{name} patch did not take"
    print("harbor patched: upload_dir fix + arena-internal/proxy compose templates")


if __name__ == "__main__":
    main()

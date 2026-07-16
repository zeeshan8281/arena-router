"""
Harbor agent adapter for the pi coding agent (WP2, spec §6.2).

The one Python component in the system (D19): Harbor loads it in-process via
`--agent-import-path agent.pi_agent:PiAgent`. It stays self-contained — no imports
from `pipeline/`; everything it needs arrives via env set by `runner.ts`:

    OPENROUTER_API_KEY   per-run capped key (inference; injected only in-container)
    PI_VENDOR_TARBALL    host path to the vendored pi npm tarball (D20)
    PI_VENDOR_SHA256     expected sha256 of that tarball (checksum gate, §6.2)
    PI_AGENT_ECHO=1      dry-run: skip the model call, emit a stub transcript
                         (key-free end-to-end plumbing test — WP2 acceptance)

Forked from badlogic/pi-terminal-bench; the substantive change is D20 compliance:
pi is installed from the vendored tarball only, never fetched from the npm registry.

Pinned to harbor 0.1.18 (see pyproject.toml). harbor >=0.18 rewrote this interface
(ExecInput / create_run_agent_commands removed) — bumping harbor means porting to the
new CliFlag/EnvVar API.
"""

import hashlib
import json
import os
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, ExecInput
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths

# Inference provider keys forwarded into the task container. The competition only
# uses OPENROUTER_API_KEY; the rest are kept so the adapter also works for local
# ad-hoc runs against other providers.
_PROVIDER_KEYS = (
    "OPENROUTER_API_KEY",
    "ANTHROPIC_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
)

_CONTAINER_TARBALL = "/installed-agent/pi.tgz"


class PiAgent(BaseInstalledAgent):
    """Runs pi headless (`pi --print --mode json`) against a Harbor task container."""

    @staticmethod
    def name() -> str:
        return "pi"

    @property
    def _install_agent_template_path(self) -> Path:
        return Path(__file__).parent / "install-pi.sh.j2"

    async def setup(self, environment: BaseEnvironment) -> None:
        """Upload the vendored pi tarball (checksum-gated) before the install script
        runs, so install.sh can `npm install -g` from it with no registry fetch (D20)."""
        tarball = os.environ.get("PI_VENDOR_TARBALL")
        if tarball:
            self._verify_vendored_pi(tarball)
            await environment.exec(command="mkdir -p /installed-agent")
            await environment.upload_file(
                source_path=Path(tarball),
                target_path=_CONTAINER_TARBALL,
            )
        await super().setup(environment)

    @staticmethod
    def _verify_vendored_pi(tarball: str) -> None:
        expected = os.environ.get("PI_VENDOR_SHA256")
        if not expected:
            return  # no checksum configured -> skip (WP1 pins it in competition.toml)
        actual = hashlib.sha256(Path(tarball).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(
                f"vendored pi checksum mismatch: expected {expected}, got {actual}"
            )

    def create_run_agent_commands(self, instruction: str) -> list[ExecInput]:
        escaped = shlex.quote(instruction)
        env = {k: os.environ[k] for k in _PROVIDER_KEYS if k in os.environ}

        model_args = ""
        if self.model_name:
            provider, model = self._parse_model_name(self.model_name)
            model_args = f"--provider {provider} --model {model}"

        out = EnvironmentPaths.agent_dir
        session = out / "session.jsonl"
        json_out = out / "pi-output.jsonl"

        if os.environ.get("PI_AGENT_ECHO") == "1":
            # Dry run: no model call, no key required. Emit one stub assistant event so
            # populate_context_post_run and the downstream plumbing have real input.
            run = (
                "printf '%s\\n' "
                + shlex.quote(
                    json.dumps(
                        {
                            "type": "message_end",
                            "message": {
                                "role": "assistant",
                                "usage": {"input": 0, "output": 0, "cost": {"total": 0.0}},
                            },
                        }
                    )
                )
                + f" | tee {json_out}"
            )
        else:
            run = (
                f"pi --print --mode json --session {session} "
                f"{model_args} {escaped} 2>&1 | tee {json_out}"
            )

        return [
            ExecInput(command=f"mkdir -p {out}", env=env),
            ExecInput(command=run, env=env),
        ]

    def _parse_model_name(self, model_name: str) -> tuple[str, str]:
        """Harbor `provider/model` -> pi (provider, model). Split once, so
        `openrouter/z-ai/glm-5.2` -> ('openrouter', 'z-ai/glm-5.2')."""
        if "/" in model_name:
            provider, model = model_name.split("/", 1)
            return provider, model
        return "anthropic", model_name

    def populate_context_post_run(self, context: AgentContext) -> None:
        """Best-effort token/cost from pi's own JSONL. NOTE: the competition scores
        OpenRouter's billed generation records (pipeline/ledger.ts), not this — these
        numbers are only a convenience signal for local iteration."""
        json_out = self.logs_dir / "pi-output.jsonl"
        if not json_out.exists():
            return

        n_in = n_out = n_cache = 0
        cost = 0.0
        for line in json_out.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = event.get("message", {})
            if event.get("type") == "message_end" and msg.get("role") == "assistant":
                usage = msg.get("usage", {})
                n_in += usage.get("input", 0)
                n_out += usage.get("output", 0)
                n_cache += usage.get("cacheRead", 0) + usage.get("cacheWrite", 0)
                cost += usage.get("cost", {}).get("total", 0.0)

        context.n_input_tokens = n_in
        context.n_output_tokens = n_out
        context.n_cache_tokens = n_cache
        context.cost_usd = cost or None

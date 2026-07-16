"""Offline tests for the pi Harbor adapter (no Docker, no key).

Covers the pure logic: model parsing, run-command shape, provider-key passthrough,
echo/dry-run switch, D20 install-template content, and the checksum gate. The
in-container upload path (setup) needs live Docker + a real vendored tarball and is
validated separately — see README.md.
"""

import os
from pathlib import Path

import pytest

from pi_agent import PiAgent

HERE = Path(__file__).parent


def _agent(tmp_path, model_name=None):
    return PiAgent(logs_dir=tmp_path, model_name=model_name)


def test_name():
    assert PiAgent.name() == "pi"


def test_parse_model_name(tmp_path):
    a = _agent(tmp_path)
    assert a._parse_model_name("openrouter/z-ai/glm-5.2") == ("openrouter", "z-ai/glm-5.2")
    assert a._parse_model_name("openrouter/openai/gpt-oss-120b") == (
        "openrouter",
        "openai/gpt-oss-120b",
    )
    assert a._parse_model_name("glm-5.2") == ("anthropic", "glm-5.2")  # default provider


def test_run_command_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    monkeypatch.delenv("PI_AGENT_ECHO", raising=False)
    a = _agent(tmp_path, model_name="openrouter/z-ai/glm-5.2")
    cmds = a.create_run_agent_commands("fix the failing test; be terse")
    run = cmds[-1]
    assert "pi --print --mode json" in run.command
    assert "--provider openrouter --model z-ai/glm-5.2" in run.command
    assert "fix the failing test" in run.command  # instruction passed through (quoted)
    assert run.env.get("OPENROUTER_API_KEY") == "sk-test"


def test_echo_mode_needs_no_model_or_key(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("PI_AGENT_ECHO", "1")
    a = _agent(tmp_path, model_name="openrouter/z-ai/glm-5.2")
    run = a.create_run_agent_commands("anything")[-1].command
    assert "pi --print" not in run          # no real agent invocation
    assert "message_end" in run             # emits a stub transcript event
    assert "pi-output.jsonl" in run         # still writes the ledger file plumbing


def test_install_template_is_vendored_only():
    tpl = (HERE / "install-pi.sh.j2").read_text()
    assert "npm install -g /installed-agent/pi.tgz" in tpl   # D20: from vendored tarball
    assert "pi-coding-agent" not in tpl                      # no registry fetch of pi
    assert "@latest" not in tpl                              # no floating version
    assert "sha256sum -c" in tpl                             # SEC C2b: shell re-verifies


def test_install_template_verifies_sha256(tmp_path):
    """SEC C2b: the rendered install script must checksum the tarball (fail-closed)
    before npm install — and the sha comes from PiAgent._template_variables."""
    a = _agent(tmp_path)
    tvars = a._template_variables
    assert "vendor_sha256" in tvars                           # exposed to the template


def test_checksum_gate(tmp_path, monkeypatch):
    blob = tmp_path / "pi.tgz"
    blob.write_bytes(b"pretend-tarball")
    import hashlib

    good = hashlib.sha256(b"pretend-tarball").hexdigest()

    monkeypatch.setenv("PI_VENDOR_SHA256", good)
    PiAgent._verify_vendored_pi(str(blob))  # matches -> no raise

    monkeypatch.setenv("PI_VENDOR_SHA256", "0" * 64)
    with pytest.raises(ValueError, match="checksum mismatch"):
        PiAgent._verify_vendored_pi(str(blob))

    # SEC C2b: fail CLOSED. A missing OR blank checksum must RAISE, never skip —
    # an unverified tarball must never reach `npm install -g`.
    monkeypatch.delenv("PI_VENDOR_SHA256", raising=False)
    with pytest.raises(ValueError, match="PI_VENDOR_SHA256 is not set"):
        PiAgent._verify_vendored_pi(str(blob))

    monkeypatch.setenv("PI_VENDOR_SHA256", "   ")  # blank/whitespace also fails closed
    with pytest.raises(ValueError, match="PI_VENDOR_SHA256 is not set"):
        PiAgent._verify_vendored_pi(str(blob))


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))

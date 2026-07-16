# legacy/ — v1 (attested router), quarantined

The v1 attested LLM-routing grader, moved here whole during the v2 pivot (spec D7/D8).
**Not deleted** — quarantined, per the handoff's "quarantine v1 → legacy/" note. It still
runs live on Sepolia + Vercel from the `main` branch; this move only affects `v2`.

Contents (unchanged, just relocated):
- `src/` — grader (SES sandbox + signed ScoreReceipt), router, worker, attestation/receipt crypto.
- `arena/` — v1 `autorouter` CLI, hidden set, catalog, skill.
- `test/`, `scripts/` — v1 tests + generators (hidden-set, excalidraw diagrams).
- `Dockerfile`, `.dockerignore`, `.env.example`, `DEPLOY.md`, `package.json`,
  `package-lock.json`, `tsconfig.json` — v1 build/deploy.

To work on v1, run from inside `legacy/` (it's a self-contained Node project). The v2
pipeline (`competition/`, `agent/`, `kit/`, `web/`) references nothing here.

Kept at repo root, not quarantined: `ui/` (SPA + GitHub OAuth — carried into v2 per §7.3)
and `HANDOFF.md`.

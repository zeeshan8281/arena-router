# Attested Router — UI

A brand-aligned (Eigen design system) visual front-end for the attested router. It routes a live prompt through the TEE conductor and then **verifies every enclave signature client-side** — the browser recovers the conductor and worker signers with `ethers.verifyMessage`, so the proof doesn't depend on trusting any server (including this UI).

Includes a **tamper toggle**: swap `chosen_model` in the displayed receipt and watch the recovered signer stop matching — proving the receipt is unaltered.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

By default it points at the live conductor; the endpoint is editable in the header (an app's public IP can change on restart — re-check via `ecloud compute app info` or the dashboard).

## Brand

Design tokens (`src/theme.css`), the `ABC Repro Variable` heading font, and the Eigen mark are pulled from `@layr-labs/eigen-design` (Figma source of truth): Eigen indigo `#1a0c6d`, near-square corners, Geist body/mono. Reproduced as plain CSS variables so the app has no private-package dependency.

## Stack

Vite + React 19 + `ethers` v6. No backend — it calls the conductor's public endpoints (which send permissive CORS by design) and does all verification in the browser.

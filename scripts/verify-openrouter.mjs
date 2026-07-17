#!/usr/bin/env node
// verify-openrouter.mjs — burn down the VERIFY markers in scoring/openrouter.mjs
// against the live Provisioning API, and PROVE the per-key credit cap is enforced
// server-side, before any real (dollar-scale) run is trusted.
//
//   node --env-file=.env scripts/verify-openrouter.mjs
//
// Needs OPENROUTER_MANAGEMENT_KEY. Total worst-case spend ≈ $0.05: the minted
// key's hard cap ($0.005) plus bounded overshoot from the cap test's paced burn
// requests (MAX_BURNS × ~$0.006) if enforcement lags usage propagation.
//
// Checklist (each prints PASS/FAIL; exit 1 if any FAIL):
//   1. mint     — POST /keys with {limit} returns a usable key + hash
//   2. status   — GET /keys/{hash} exposes usage / limit / limit_remaining / byok_usage
//   3. infer    — the minted key performs one tiny inference (allowlisted model)
//   4. ledger   — billed usage becomes visible on the key after the call
//   5. cap      — requests start failing with 402 once usage reaches the limit
//   6. gens     — keyGenerations() returns per-record model/cost rows (VERIFY: shape)
//   7. delete   — DELETE /keys/{hash} works and the dead key is rejected
//
// SECRETS HYGIENE: never prints key material — only the key hash, field names,
// booleans, and dollar amounts.
import { mintKey, keyStatus, deleteKey, keyGenerations } from "../competition/scoring/openrouter.mjs";

const BASE = process.env.OPENROUTER_BASE || "https://openrouter.ai/api/v1";
const LIMIT_USD = 0.005; // the key's hard cap — bounds the whole script's spend
const MODEL = "openai/gpt-oss-120b"; // cheapest allowlisted model ($0.04/$0.17 per M)
// Cap probe: tiny calls on the cheap model cost ~$0.000003 each and would NEVER
// reach the cap. Burning past $0.005 needs deliberately expensive calls — the
// baseline model at $3/M output, ~2k tokens/call ≈ $0.006 per burn. Enforcement
// lags usage propagation, so allow a few burns to slip through before 402.
const BURN_MODEL = "z-ai/glm-5.2";
const MAX_BURNS = 8; // worst-case overshoot ≈ 8 × $0.006 ≈ $0.05 — still dime-scale

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

/** One inference on the minted key. tiny=true is a ~$0.000003 probe; tiny=false
 *  is a ~$0.006 burn used ONLY by the cap test. Returns {status} — 200 = billed. */
async function inference(key, { tiny = true } = {}) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(
      tiny
        ? { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word: ok" }] }
        : { model: BURN_MODEL, max_tokens: 2048, messages: [{ role: "user", content: "Write a detailed 1500-word essay on the history of container orchestration." }] },
    ),
  });
  // Drain the body so the connection is reusable; never log it (noise, not secret).
  const body = await r.json().catch(() => ({}));
  return { status: r.status, id: body.id ?? null };
}

async function main() {
  const mgmt = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!mgmt) {
    console.error("OPENROUTER_MANAGEMENT_KEY is not set (use: node --env-file=.env …)");
    process.exit(2);
  }
  console.log(`verify-openrouter: cap=$${LIMIT_USD} model=${MODEL}\n`);

  // ── 1. mint ────────────────────────────────────────────────────────────────
  let key, hash;
  try {
    ({ key, hash } = await mintKey(mgmt, "verify-cap-probe", LIMIT_USD));
    check("mint: POST /keys returns key + hash", Boolean(key && hash), `hash=${hash}`);
  } catch (e) {
    check("mint: POST /keys returns key + hash", false, e.message);
    return finish();
  }
  if (!key || !hash) return finish();

  try {
    // ── 2. status field names ────────────────────────────────────────────────
    let st;
    try {
      st = await keyStatus(mgmt, hash);
      check(
        "status: usage/limit/limit_remaining/byok_usage present",
        st.usage === 0 && st.limit === LIMIT_USD && Number.isFinite(st.byok_usage),
        `usage=${st.usage} limit=${st.limit} limit_remaining=${st.limit_remaining} byok_usage=${st.byok_usage}`,
      );
    } catch (e) {
      check("status: usage/limit/limit_remaining/byok_usage present", false, e.message);
    }

    // ── 3. one tiny inference on the minted key ─────────────────────────────
    const first = await inference(key);
    check("infer: minted key performs inference", first.status === 200, `http ${first.status}`);

    // ── 4. billed usage appears on the key ledger ───────────────────────────
    // Usage propagation is async on OpenRouter's side; poll briefly.
    let usageSeen = 0;
    for (let i = 0; i < 12 && usageSeen === 0; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      usageSeen = (await keyStatus(mgmt, hash)).usage;
    }
    check("ledger: key usage reflects the call", usageSeen > 0, `usage=$${usageSeen}`);

    // ── 5. THE test: cap bites server-side ──────────────────────────────────
    // Deliberately burn past the $0.005 limit and confirm OpenRouter starts
    // rejecting. Every burn bills the CAPPED key; worst case ≈ MAX_BURNS × one
    // burn (~$0.05 total) if enforcement lags, or the cap never bites (FAIL).
    let capHit = null;
    for (let i = 0; i < MAX_BURNS; i++) {
      const r = await inference(key, { tiny: false });
      if (r.status !== 200) { capHit = r.status; break; }
      // Usage propagation is async (see check 4) — pace the burns so the
      // enforcement side catches up; rapid-fire could outrun a stale ledger.
      await new Promise((res) => setTimeout(res, 5000));
    }
    check(
      "cap: requests rejected once limit is reached",
      capHit === 402 || capHit === 403,
      capHit ? `http ${capHit}` : `no rejection after ${MAX_BURNS} burns — DO NOT run anything real until this passes`,
    );

    // ── 6. generation records (weakest VERIFY — endpoint + pagination shape) ─
    try {
      const gens = await keyGenerations(mgmt, hash, { maxPages: 2 });
      const g = gens[0];
      check(
        "gens: keyGenerations returns model/cost records",
        gens.length > 0 && Boolean(g?.model) && Number.isFinite(g?.total_cost),
        `records=${gens.length} first={model:${g?.model}, total_cost:${g?.total_cost}, byok:${g?.byok}}`,
      );
    } catch (e) {
      check("gens: keyGenerations returns model/cost records", false, e.message);
    }
  } finally {
    // ── 7. teardown + dead-key rejection (always attempted) ─────────────────
    try {
      await deleteKey(mgmt, hash);
      const dead = await inference(key);
      check("delete: key removed and rejected afterwards", dead.status === 401 || dead.status === 403, `post-delete http ${dead.status}`);
    } catch (e) {
      check("delete: key removed and rejected afterwards", false, e.message);
    }
  }
  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("VERIFY markers NOT cleared — fix scoring/openrouter.mjs field mapping before any real run.");
    process.exit(1);
  }
  console.log("All VERIFY markers cleared: caps enforce server-side; field names confirmed.");
}

main();

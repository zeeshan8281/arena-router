// OpenRouter Provisioning + generation ledger — ci-anti-abuse §1. Every CI run
// mints a FRESH key with a hard credit cap, runs the harness with only that key,
// then reads the key's billed usage (the official cost) and deletes it. A leaked
// key is capped and dies minutes later.
//
// Auth: a PROVISIONING (management) key — separate from inference, cannot run
// inference. Response shapes follow OpenRouter's Provisioning API; VERIFY the
// exact fields against a live key before launch (marked below).
const BASE = process.env.OPENROUTER_BASE || "https://openrouter.ai/api/v1";

async function req(mgmt, method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${mgmt}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`openrouter ${method} ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Mint a capped key. Returns { key, hash }. `key` is the sk-or-... secret used
 *  for inference; `hash` identifies it for status/delete. */
export async function mintKey(mgmt, name, limitUsd) {
  const j = await req(mgmt, "POST", "/keys", { name, limit: limitUsd });
  return { key: j.key, hash: j.data?.hash ?? j.hash, name, limit: limitUsd }; // VERIFY: field names
}

/** Key status incl. billed usage + byok_usage (the ground-truth cost + BYOK check). */
export async function keyStatus(mgmt, hash) {
  const j = await req(mgmt, "GET", `/keys/${hash}`);
  const d = j.data ?? j;
  return { usage: Number(d.usage) || 0, limit: d.limit, limit_remaining: d.limit_remaining, byok_usage: Number(d.byok_usage) || 0 };
}

export async function deleteKey(mgmt, hash) {
  await req(mgmt, "DELETE", `/keys/${hash}`);
  return true;
}

/** Per-generation record (model, tokens, cost, byok) — needs the generation id
 *  the harness logged from each inference response. Used for allowlist/anomaly. */
export async function generation(inferenceKey, id) {
  const r = await fetch(`${BASE}/generation?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${inferenceKey}` } });
  if (!r.ok) throw new Error(`generation ${id} → ${r.status}`);
  const d = (await r.json()).data ?? {};
  return { id, model: d.model, total_cost: Number(d.total_cost) || 0, tokens_prompt: d.tokens_prompt, tokens_completion: d.tokens_completion, cache_discount: d.cache_discount };
}

/** List ALL generation records billed to a minted key (spec §6.1.5 "pull the key's
 *  generation records"). This is the authoritative per-record source for the allowlist
 *  + anomaly checks — one call, no per-id lookups, no transcript gen-ids needed.
 *  VERIFY: endpoint path + record field names against a live management key. */
export async function keyGenerations(mgmt, keyHash) {
  const r = await fetch(`${BASE}/generations?key_hash=${encodeURIComponent(keyHash)}`, {
    headers: { authorization: `Bearer ${mgmt}` },
  });
  if (!r.ok) throw new Error(`keyGenerations ${keyHash} → ${r.status}`);
  const rows = (await r.json()).data ?? [];
  return rows.map((d) => ({
    id: d.id,
    model: d.model,
    total_cost: Number(d.total_cost) || 0,
    tokens_prompt: Number(d.tokens_prompt) || 0,
    tokens_completion: Number(d.tokens_completion) || 0,
    cache_read_tokens: Number(d.cache_discount ? d.native_tokens_cached : d.tokens_cached) || 0,
    byok: Boolean(d.is_byok),
  }));
}

/** Billed usage of the CALLING inference key (spec §6.5: the participant's own ledger).
 *  Lets `arena smoke` report ledger cost without a management key.
 *  VERIFY: `/key` response shape against a live inference key. */
export async function selfKeyUsage(inferenceKey) {
  const r = await fetch(`${BASE}/key`, { headers: { authorization: `Bearer ${inferenceKey}` } });
  if (!r.ok) throw new Error(`selfKeyUsage → ${r.status}`);
  const d = (await r.json()).data ?? {};
  return { usage: Number(d.usage) || 0, limit: d.limit, limit_remaining: d.limit_remaining };
}

/** One-shot lifecycle helper for CI: mint → hand key to `runFn(key)` → read
 *  billed cost → delete (always). Returns { cost_usd, byok_usage, result }. */
export async function withCappedKey(mgmt, name, limitUsd, runFn) {
  const { key, hash } = await mintKey(mgmt, name, limitUsd);
  try {
    const result = await runFn(key);
    const status = await keyStatus(mgmt, hash);
    return { cost_usd: status.usage, byok_usage: status.byok_usage, limit_remaining: status.limit_remaining, result };
  } finally {
    await deleteKey(mgmt, hash).catch(() => {}); // best-effort teardown; leaked key is capped anyway
  }
}

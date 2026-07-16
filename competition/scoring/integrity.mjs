// Score integrity — ci-anti-abuse §3b. Pure checks over a run's OpenRouter
// generation records + the provisioned key's status. A run that trips a hard
// check is VOID (unspoofable — the ledger is ground truth, not the harness).
//   - BYOK banned:       key.byok_usage must be 0
//   - allowlist:         every generation's model ∈ the 8-model allowlist
//   - :free variants:    banned
//   - token anomaly:     a hard task passing on absurdly few tokens → flag (not void)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ALLOWLIST = JSON.parse(readFileSync(join(HERE, "models.json"), "utf8")).allowlist.map((m) => m.slug);

/** Hard integrity: returns { void, flags }. void ⇒ the run does not score.
 *  Fails CLOSED on missing inputs — an unverifiable run must never score:
 *    - keyStatus null/absent  ⇒ can't confirm BYOK=0            → void (keystatus-unavailable)
 *    - empty generations list ⇒ couldn't verify what ran        → void (no-generations)
 *    - a record with no model ⇒ can't check it against allowlist → void (missing-model)
 */
export function checkIntegrity({ generations = [], keyStatus = null, allowlist = ALLOWLIST }) {
  const allow = new Set(allowlist);
  const flags = [];
  let isVoid = false;

  // H9: without key status (or a non-finite byok_usage) we can't confirm BYOK=0.
  if (!keyStatus || !Number.isFinite(Number(keyStatus.byok_usage))) {
    isVoid = true;
    flags.push({ severity: "void", type: "keystatus-unavailable", detail: "key status/byok_usage unavailable — cannot confirm BYOK=0" });
  } else if (Number(keyStatus.byok_usage) > 0) {
    isVoid = true;
    flags.push({ severity: "void", type: "byok", detail: `byok_usage=${keyStatus.byok_usage} (BYOK banned)` });
  }

  // H2: no generation records means we have nothing to verify against the ledger.
  if (!generations.length) {
    isVoid = true;
    flags.push({ severity: "void", type: "no-generations", detail: "no generation records — run unverifiable" });
  }

  for (const g of generations) {
    const model = g.model || "";
    if (!model) {
      // H1: every record must carry an allowlisted model — empty/missing is a void.
      isVoid = true;
      flags.push({ severity: "void", type: "missing-model", detail: "generation record has no model" });
    } else if (model.endsWith(":free")) {
      isVoid = true;
      flags.push({ severity: "void", type: "free-variant", detail: model });
    } else if (!allow.has(model)) {
      isVoid = true;
      flags.push({ severity: "void", type: "off-allowlist", detail: model });
    }
  }
  return { void: isVoid, flags };
}

/** Total tokens for a ledger row. The ledger produces tokens_prompt/tokens_completion
 *  (+ optional cache fields), not total_tokens — so fall back to their sum when
 *  total_tokens is absent, else the anomaly check compares against NaN and never fires. */
function rowTokens(r) {
  if (r.total_tokens != null) return Number(r.total_tokens);
  return (Number(r.tokens_prompt) || 0) + (Number(r.tokens_completion) || 0) +
    (Number(r.tokens_cached) || 0) + (Number(r.native_tokens_cached) || 0);
}

/** Soft anomaly (§3a.4): a hard task passing on implausibly few tokens → review,
 *  not auto-disqualify. `rows`: [{ task, passed, difficulty, total_tokens | tokens_prompt+tokens_completion }]. */
export function tokenAnomalies(rows = [], minTokens = 5000) {
  return rows
    .filter((r) => r.passed && String(r.difficulty).toLowerCase() === "hard" && rowTokens(r) < minTokens)
    .map((r) => ({ severity: "review", type: "low-token-pass", task: r.task, tokens: rowTokens(r) }));
}

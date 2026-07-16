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

/** Hard integrity: returns { void, flags }. void ⇒ the run does not score. */
export function checkIntegrity({ generations = [], keyStatus = null, allowlist = ALLOWLIST }) {
  const allow = new Set(allowlist);
  const flags = [];
  let isVoid = false;

  if (keyStatus && Number(keyStatus.byok_usage) > 0) {
    isVoid = true;
    flags.push({ severity: "void", type: "byok", detail: `byok_usage=${keyStatus.byok_usage} (BYOK banned)` });
  }
  for (const g of generations) {
    const model = g.model || "";
    if (model.endsWith(":free")) {
      isVoid = true;
      flags.push({ severity: "void", type: "free-variant", detail: model });
    } else if (model && !allow.has(model)) {
      isVoid = true;
      flags.push({ severity: "void", type: "off-allowlist", detail: model });
    }
  }
  return { void: isVoid, flags };
}

/** Soft anomaly (§3a.4): a hard task passing on implausibly few tokens → review,
 *  not auto-disqualify. `rows`: [{ task, passed, difficulty, total_tokens }]. */
export function tokenAnomalies(rows = [], minTokens = 5000) {
  return rows
    .filter((r) => r.passed && r.difficulty === "hard" && Number(r.total_tokens) < minTokens)
    .map((r) => ({ severity: "review", type: "low-token-pass", task: r.task, tokens: r.total_tokens }));
}

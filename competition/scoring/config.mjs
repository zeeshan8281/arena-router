// competition.toml loader + validation (spec §8, WP1). Node ships no TOML parser and
// our config is a flat set of tables with scalar / string-array values, so a focused
// subset parser beats pulling a dependency.
// ponytail: minimal TOML — tables, strings, numbers, bools, string/number arrays
// (may span lines), # comments. No inline tables, dates, or nested arrays. If the
// config ever needs those, swap in a real TOML dep.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWLIST } from "./integrity.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Strip a trailing `# comment` that is outside a double-quoted string. */
function stripComment(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inStr = !inStr;
    else if (c === "#" && !inStr) return line.slice(0, i);
  }
  return line;
}

const balanced = (s) => (s.match(/\[/g)?.length || 0) === (s.match(/\]/g)?.length || 0);

function parseScalar(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/** Split top-level array elements on commas (our arrays never nest). */
function parseArray(raw) {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];
  const parts = [];
  let cur = "";
  let inStr = false;
  for (const c of inner) {
    if (c === '"') inStr = !inStr;
    if (c === "," && !inStr) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map(parseScalar);
}

export function parseToml(text) {
  const root = {};
  let cur = root;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const s = stripComment(lines[i]).trim();
    if (!s) continue;
    if (s.startsWith("[")) {
      const path = s.slice(1, s.indexOf("]")).split(".").map((p) => p.trim());
      cur = root;
      for (const p of path) cur = cur[p] ??= {};
      continue;
    }
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (val.startsWith("[")) {
      while (!balanced(val) && i + 1 < lines.length) val += " " + stripComment(lines[++i]).trim();
      cur[key] = parseArray(val);
    } else {
      cur[key] = parseScalar(val);
    }
  }
  return root;
}

/** M11: the TOML [models] allowlist and models.json are two sources of truth for the
 *  same list — a divergence would let one check pass a model the other rejects. Assert
 *  they hold the exact same set (order-independent) and throw on any mismatch. */
export function assertAllowlistConsistent(config, slugs = ALLOWLIST) {
  const toml = config?.models?.allowlist ?? [];
  const a = new Set(toml);
  const b = new Set(slugs);
  const onlyToml = [...a].filter((s) => !b.has(s));
  const onlyJson = [...b].filter((s) => !a.has(s));
  if (onlyToml.length || onlyJson.length) {
    throw new Error(
      `models allowlist diverged between competition.toml and models.json — ` +
      `only in toml: [${onlyToml.join(", ")}]; only in models.json: [${onlyJson.join(", ")}]`,
    );
  }
  return true;
}

export function loadConfig(path = join(REPO_ROOT, "competition.toml")) {
  const config = parseToml(readFileSync(path, "utf8"));
  assertAllowlistConsistent(config);
  return config;
}

/** The TBD(probe) sentinel is -1 (spec §8). Official (non-baseline) runs are refused
 *  while any remains. Returns the list of unfrozen fields ([] when ready). */
export function pendingTbd(config) {
  const pending = [];
  if (config?.smoke?.gate === -1) pending.push("smoke.gate");
  if (config?.full?.eligibility_bar === -1) pending.push("full.eligibility_bar");
  return pending;
}

/** Throw unless the config is ready for an official run of `runType`. Baseline runs
 *  are exempt — they exist to fill the sentinels. */
export function assertRunnable(config, runType) {
  if (runType === "baseline") return;
  const pending = pendingTbd(config);
  if (pending.length) {
    throw new Error(`config not frozen — run the baseline probe first; pending: ${pending.join(", ")}`);
  }
}

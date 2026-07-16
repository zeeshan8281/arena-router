#!/usr/bin/env node
// `arena` — participant kit CLI (spec §6.5, WP10). Thin wrapper over the pipeline
// modules. init/check/verify-pi/report run offline; smoke needs the participant's own
// OPENROUTER_API_KEY. Commands are exported for tests; the dispatcher is at the bottom.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../competition/scoring/config.mjs";
import { runChecks } from "../competition/anti-abuse/checks.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** GitHub login via `gh`, or the --author override. */
export function resolveAuthor(override) {
  if (override) return override;
  try {
    return execFileSync("gh", ["api", "user", "-q", ".login"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("could not resolve GitHub login — install/auth `gh`, or pass --author <login>");
  }
}

/** Scaffold submissions/<author>/ from the _template. Returns the created dir. */
export function initCmd(author, { root = REPO_ROOT } = {}) {
  const dir = join(root, "submissions", author);
  if (existsSync(dir)) throw new Error(`submissions/${author}/ already exists`);
  const tpl = join(root, "submissions", "_template");
  mkdirSync(dir, { recursive: true });
  const manifest = readFileSync(join(tpl, "manifest.toml"), "utf8").replace(/author\s*=\s*"[^"]*"/, `author = "${author}"`);
  writeFileSync(join(dir, "manifest.toml"), manifest);
  for (const sub of ["plugins", "skills", "profiles", "config"]) {
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, sub, ".gitkeep"), "");
  }
  return dir;
}

/** Run the static checks locally on a diff (default: working tree vs origin/main). */
export function checkCmd({ diff, author, root = REPO_ROOT } = {}) {
  const d = diff ?? execFileSync("git", ["-C", root, "diff", "origin/main...HEAD"], { encoding: "utf8" });
  return runChecks(d, author ? { author } : {});
}

/** Verify the local vendored pi checksum matches competition.toml (§6.5). */
export function verifyPiCmd({ root = REPO_ROOT } = {}) {
  const expected = loadConfig(join(root, "competition.toml")).pi.sha256;
  const actual = createHash("sha256").update(readFileSync(join(root, "vendor/pi/pi.tgz"))).digest("hex");
  return { ok: actual === expected, expected, actual };
}

/** Render the latest smoke --out artifacts as a cost/pass table (§6.5 `arena report`). */
export function reportCmd({ outDir, root = REPO_ROOT } = {}) {
  const base = outDir ?? join(root, ".arena", "out");
  if (!existsSync(base)) return { runs: [], text: "no artifacts yet — run `arena smoke --out <dir>` first" };
  const files = readdirSync(base).filter((f) => f.endsWith(".json")).sort();
  const runs = files.map((f) => JSON.parse(readFileSync(join(base, f), "utf8")));
  const rows = runs.map((r) => `${r.run_id ?? "?"}\tpass ${r.median_pass_count ?? "?"}\t$${r.median_billed_usd ?? "?"}`);
  return { runs, text: ["run\tpass\tcost", ...rows].join("\n") };
}

// ---- dispatcher ----
const HELP = `arena — harness-efficiency kit
  arena init [--author <login>]      scaffold submissions/<login>/
  arena check [--author <login>]     run static checks on your diff
  arena verify-pi                    confirm vendored pi checksum
  arena smoke [--trials N] [--tasks a,b] [--out dir]   run the smoke set (needs OPENROUTER_API_KEY)
  arena report [--out dir]           show latest cost/pass table`;

function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const get = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
  try {
    switch (cmd) {
      case "init": { const dir = initCmd(resolveAuthor(get("--author"))); console.log(`scaffolded ${dir}`); break; }
      case "check": { const r = checkCmd({ author: get("--author") }); console.log(r.block ? `BLOCK: ${r.reason}` : `OK (author=${r.author})`); process.exit(r.block ? 1 : 0); }
      case "verify-pi": { const r = verifyPiCmd(); console.log(r.ok ? `✓ vendored pi matches (${r.expected.slice(0, 12)}…)` : `✗ MISMATCH expected ${r.expected} got ${r.actual}`); process.exit(r.ok ? 0 : 1); }
      case "report": { console.log(reportCmd({ outDir: get("--out") }).text); break; }
      case "smoke": { console.error("`arena smoke` runs Harbor locally with your OPENROUTER_API_KEY.\nSee competition/LOCAL_SETUP.md; the runner wiring lives in competition/runner.mjs.\n(Not yet wired into the kit — needs a key to validate.)"); process.exit(2); }
      default: console.log(HELP);
    }
  } catch (e) { console.error(`arena: ${e.message}`); process.exit(1); }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);

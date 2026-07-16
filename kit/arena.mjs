#!/usr/bin/env node
// `arena` — participant kit CLI (spec §6.5, WP10). Thin wrapper over the pipeline
// modules. init/check/verify-pi/report run offline; smoke needs the participant's own
// OPENROUTER_API_KEY. Commands are exported for tests; the dispatcher is at the bottom.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../competition/scoring/config.mjs";
import { runChecks } from "../competition/anti-abuse/checks.mjs";
import { selfKeyUsage } from "../competition/scoring/openrouter.mjs";
import { runSmoke, summarizeRun, reportDeltas } from "./smoke.mjs";

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

/** Real local Harbor spawn for one smoke trial → returns the Harbor run dir. */
function harborSpawn(root, config, model, submission) {
  return (key, { tasks, trialIndex, outDir }) => {
    const trialOut = join(outDir, `trial-${trialIndex}-harbor`);
    const args = ["run", "-d", config.benchmark.dataset, "--agent-import-path", "pi_agent:PiAgent", "-m", model, "-n", String(config.benchmark.concurrency), "-o", trialOut];
    for (const t of tasks) args.push("-t", t);
    const env = { ...process.env, OPENROUTER_API_KEY: key, PI_VENDOR_TARBALL: join(root, "vendor/pi/pi.tgz"), PI_VENDOR_SHA256: config.pi.sha256, PI_SUBMISSION_DIR: submission || "" };
    const r = spawnSync("harbor", args, { env, stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`harbor exited ${r.status}`);
    const sub = readdirSync(trialOut).map((d) => join(trialOut, d)).sort();
    return sub[sub.length - 1]; // newest run dir under trialOut
  };
}

/** Run the smoke set locally with the participant's own key (§6.5). Cost comes from the
 *  key's own usage ledger (selfKeyUsage), not pi's self-report. */
export function smokeCmd({ trials, tasks, model, submission, outDir, root = REPO_ROOT } = {}) {
  const config = loadConfig(join(root, "competition.toml"));
  const runOut = outDir ?? join(root, ".arena", "out", "latest");
  const m = model ?? `openrouter/${config.models.baseline_model}`;
  return runSmoke({
    key: process.env.OPENROUTER_API_KEY,
    trials: trials ?? config.smoke.trials,
    tasks: tasks ?? config.smoke.tasks,
    outDir: runOut,
    spawn: harborSpawn(root, config, m, submission),
    usage: (key) => selfKeyUsage(key),
  });
}

/** Render the latest run's cost/pass table with deltas vs the previous run (§6.5). */
export function reportCmd({ outDir, root = REPO_ROOT } = {}) {
  const base = outDir ?? join(root, ".arena", "out");
  if (!existsSync(base)) return { text: "no artifacts yet — run `arena smoke` first" };
  // run dirs = subdirs holding trial-*.json; newest two compared
  const runDirs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, "trial-0.json")))
    .map((d) => join(base, d.name)).sort();
  if (!runDirs.length) return { text: "no completed runs yet — run `arena smoke` first" };
  const cur = summarizeRun(runDirs[runDirs.length - 1]);
  const prev = runDirs.length > 1 ? summarizeRun(runDirs[runDirs.length - 2]) : null;
  return { text: reportDeltas(cur, prev), current: cur, previous: prev };
}

// ---- dispatcher ----
const HELP = `arena — harness-efficiency kit
  arena init [--author <login>]      scaffold submissions/<login>/
  arena check [--author <login>]     run static checks on your diff
  arena verify-pi                    confirm vendored pi checksum
  arena smoke [--trials N] [--tasks a,b] [--out dir]   run the smoke set (needs OPENROUTER_API_KEY)
  arena report [--out dir]           show latest cost/pass table`;

async function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const get = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
  try {
    switch (cmd) {
      case "init": { const dir = initCmd(resolveAuthor(get("--author"))); console.log(`scaffolded ${dir}`); break; }
      case "check": { const r = checkCmd({ author: get("--author") }); console.log(r.block ? `BLOCK: ${r.reason}` : `OK (author=${r.author})`); process.exit(r.block ? 1 : 0); }
      case "verify-pi": { const r = verifyPiCmd(); console.log(r.ok ? `✓ vendored pi matches (${r.expected.slice(0, 12)}…)` : `✗ MISMATCH expected ${r.expected} got ${r.actual}`); process.exit(r.ok ? 0 : 1); }
      case "report": { console.log(reportCmd({ outDir: get("--out") }).text); break; }
      case "smoke": {
        if (!process.env.OPENROUTER_API_KEY) { console.error("set OPENROUTER_API_KEY (your own inference key) to run a local smoke"); process.exit(2); }
        const tasksArg = get("--tasks"); const trialsArg = get("--trials");
        const r = await smokeCmd({
          trials: trialsArg ? Number(trialsArg) : undefined,
          tasks: tasksArg ? tasksArg.split(",").map((s) => s.trim()) : undefined,
          model: get("--model"), submission: get("--submission"), outDir: get("--out"),
        });
        console.log(`smoke: median pass ${r.median_pass}, median cost $${r.median_cost} (${r.trials.length} trials)`);
        break;
      }
      default: console.log(HELP);
    }
  } catch (e) { console.error(`arena: ${e.message}`); process.exit(1); }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);

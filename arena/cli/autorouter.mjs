#!/usr/bin/env node
// autorouter — competition CLI, mirrors the FrontierCS onboarding
//   login · config · benchmark · clone · setup · run · submit · submissions · leaderboard · verify
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifyMessage } from "ethers";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");   // arena/
const CFG_DIR = join(homedir(), ".config", "autorouter");
const CFG = join(CFG_DIR, "config.json");
const DEFAULT_API = process.env.AUTOROUTER_API || "http://34.7.20.95:8080"; // live autorouter-grader (EigenCompute)

const cfg = () => (existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : {});
const saveCfg = (c) => { mkdirSync(CFG_DIR, { recursive: true }); writeFileSync(CFG, JSON.stringify(c, null, 2)); };
const api = () => cfg().api || DEFAULT_API;
const me = () => cfg().participant || "anon";
const die = (m) => { console.error("error:", m); process.exit(1); };

async function get(path) { const r = await fetch(api() + path); if (!r.ok) die(`${path} → ${r.status}`); return r.json(); }
async function post(path, body) {
  const r = await fetch(api() + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) die(j.error || `${path} → ${r.status}`); return j;
}

// canonicalize must match src/crypto.ts (recursive key sort)
const canon = (v) => JSON.stringify((function s(x){ return Array.isArray(x)?x.map(s):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(k=>[k,s(x[k])])):x; })(v));

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "login": {                                   // autorouter login <handle> [--api url]
    const handle = args[0] || die("usage: autorouter login <handle> [--api <url>]");
    const i = args.indexOf("--api");
    const c = cfg(); c.participant = handle; if (i >= 0) c.api = args[i + 1];
    saveCfg(c); console.log(`logged in as "${handle}" · grader ${api()}`); break;
  }
  case "config":
    console.log(JSON.stringify({ api: api(), participant: me() }, null, 2)); break;

  case "benchmark": {                               // autorouter benchmark [show]
    const b = await get("/benchmark");
    console.log(`\n${b.name}  (v${b.version})`);
    console.log(`objective : ${b.objective}`);
    console.log(`params    : λ=${b.scoring_params.cost_penalty_lambda} β=${b.scoring_params.openness_bonus_beta} threshold=${b.scoring_params.confidence_threshold}`);
    console.log(`hidden set: ${b.n_prompts} prompts · eval_set_hash ${b.eval_set_hash.slice(0, 18)}…`);
    console.log(`models    :`); for (const m of b.models) console.log(`  ${m.open_source ? "○" : "●"} ${m.id.padEnd(30)} $${m.price_per_call}/call  (${m.tier})`);
    console.log(); break;
  }
  case "clone": {                                   // autorouter clone [dir]
    const dir = resolve(args[0] || "autorouter-policy");
    mkdirSync(dir, { recursive: true });
    for (const f of ["types.ts", "run.mjs", "score.mjs"]) if (existsSync(join(KIT, f))) copyFileSync(join(KIT, f), join(dir, f));
    cpSync(join(KIT, "config"), join(dir, "config"), { recursive: true });
    cpSync(join(KIT, "dev"), join(dir, "dev"), { recursive: true });
    if (!existsSync(join(dir, "policy.ts"))) copyFileSync(join(KIT, "policy.template.ts"), join(dir, "policy.ts"));
    console.log(`cloned starter → ${dir}\n  edit policy.ts, then:  autorouter run   ·   autorouter submit`); break;
  }
  case "setup":
    console.log("installing tsx (local scorer needs it)…");
    spawnSync("npm", ["i", "-D", "tsx"], { stdio: "inherit" }); break;

  case "run": {                                     // autorouter run [policy.ts]
    const policy = resolve(args[0] || "policy.ts");
    if (!existsSync(policy)) die(`no ${policy} (autorouter clone first)`);
    const runner = existsSync(join(KIT, "run.mjs")) ? join(KIT, "run.mjs") : "run.mjs";
    const r = spawnSync("node", ["--import", "tsx", runner, policy], { stdio: "inherit" });
    process.exit(r.status ?? 0); break;
  }
  case "submit": {                                  // autorouter submit [policy.ts] [--note "..."]
    const policyPath = resolve(args[0] && !args[0].startsWith("--") ? args[0] : "policy.ts");
    if (!existsSync(policyPath)) die(`no ${policyPath}`);
    const ni = args.indexOf("--note"); const note = ni >= 0 ? args[ni + 1] : "";
    const policy = readFileSync(policyPath, "utf8");
    console.log(`submitting ${policyPath} as "${me()}" → ${api()} …`);
    const d = await post("/submit", { policy, participant: me(), note });
    // verify the signed score locally
    const recovered = verifyMessage(canon(d.receipt), d.signature);
    const ok = recovered.toLowerCase() === d.grader_address.toLowerCase();
    console.log(`\n  SCORE      ${d.score}`);
    console.log(`  quality    ${d.mean_quality}   compute $${d.mean_cost}${d.invalid?`   invalid ${d.invalid}`:""}`);
    console.log(`  submission ${d.submission_id}`);
    console.log(`  signature  ${ok ? "✓ signed by grader enclave " + recovered.slice(0,10)+"…" : "✗ SIGNATURE MISMATCH"}\n`);
    break;
  }
  case "submissions": {                             // autorouter submissions
    const { submissions } = await get(`/submissions?participant=${encodeURIComponent(me())}`);
    if (!submissions.length) { console.log("no submissions yet"); break; }
    for (const s of submissions) console.log(`${s.score}\t${s.submission_id.slice(0,8)}\t${s.note || ""}`);
    break;
  }
  case "leaderboard": {                             // autorouter leaderboard
    const { leaderboard } = await get("/leaderboard");
    console.log("\nrank  score   participant");
    for (const r of leaderboard) console.log(`${String(r.rank).padStart(3)}   ${String(r.score).padEnd(7)} ${r.participant}`);
    console.log(); break;
  }
  case "verify": {                                  // autorouter verify <submission_id>
    const id = args[0] || die("usage: autorouter verify <submission_id>");
    const s = await get(`/submission/${id}`);
    const rec = verifyMessage(canon(s.receipt), s.signature);
    const ok = rec.toLowerCase() === s.grader_address.toLowerCase();
    console.log(ok ? `✓ VERIFIED — score ${s.receipt.score} signed by grader ${rec}` : `✗ signature does not match ${s.grader_address}`);
    break;
  }
  default:
    console.log(`autorouter — AutoRouter Arena CLI

  login <handle> [--api <url>]   set your identity + grader endpoint
  config                         show current config
  benchmark                      show the active benchmark (models, params, hidden-set hash)
  clone [dir]                    scaffold a policy workspace
  setup                          install local dev deps (tsx)
  run [policy.ts]                score your policy locally on the public dev set
  submit [policy.ts] [--note x]  grade on the hidden set inside the TEE → signed score
  submissions                    your submissions
  leaderboard                    top score per participant
  verify <submission_id>         re-check a submission's enclave signature`);
}

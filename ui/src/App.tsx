import { useEffect, useState } from "react";
import {
  verifyReceipt, short, DEFAULT_POLICY,
  type Benchmark, type LeaderRow, type SubmitResult,
} from "./arena";

// Reads (benchmark/leaderboard) → grader (via /grader proxy on Vercel, direct locally).
const GRADER = import.meta.env.VITE_GRADER_BASE || "http://34.187.54.54:8080";
const ON_VERCEL = Boolean(import.meta.env.VITE_GRADER_BASE);
const REPO = "https://github.com/zeeshan8281/arena-router";
const GRADER_DASH = "https://verify.eigencloud.xyz/app/0x6aA6Df01701e1bbDC4449E04dBe73282B731B6C3";

type Session = { login: string | null; configured: boolean } | "local" | "loading";

export default function App() {
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [me, setMe] = useState<Session>("loading");

  const loadBoard = () => fetch(`${GRADER}/leaderboard`).then((r) => r.json()).then((d) => setBoard(d.leaderboard || [])).catch(() => {});
  useEffect(() => {
    fetch(`${GRADER}/benchmark`).then((r) => r.json()).then(setBench).catch(() => {});
    loadBoard();
    fetch("/api/me").then((r) => { if (!r.ok) throw 0; return r.json(); }).then(setMe).catch(() => setMe("local"));
  }, []);

  const p = bench?.scoring_params;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const signedIn = me !== "loading" && me !== "local" && me.login;

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <div className="brandmark">
            <img src="/eigen-icon.svg" alt="Eigen" />
            <span className="divider" />
            <span className="title">AutoRouter Arena</span>
          </div>
          <div className="spacer" />
          <nav className="nav">
            <span className="navlink" onClick={() => go("grading")}>How it works</span>
            <span className="navlink" onClick={() => go("participate")}>Participate</span>
            <span className="navlink" onClick={() => go("leaderboard")}>Score history</span>
          </nav>
          <AuthPill me={me} />
        </div>
      </header>

      <main className="wrap">
        <section style={{ paddingTop: 64, borderTop: "none" }}>
          <div className="eyebrow">Attested routing benchmark · Intel TDX on EigenCompute</div>
          <h1 className="hero-h">Can your router<br />beat the frontier?</h1>
          <p className="lede" style={{ marginTop: 18 }}>
            Write one function — <span className="mono">decide()</span>. An attested grader runs it against a
            <b style={{ color: "var(--foreground)" }}> hidden</b> prompt set inside a TEE and
            <b style={{ color: "var(--foreground)" }}> signs</b> your score. Highest quality per dollar, leaning on open models, wins — and every number on the board is cryptographically verifiable.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
            <button className="btn indigo" onClick={() => go("participate")}>Participate →</button>
            <button className="btn outline" onClick={() => go("leaderboard")}>Score history</button>
          </div>
          <div className="affil" style={{ marginTop: 28 }}>
            <span>An EigenCompute project</span><span>·</span>
            <a href={GRADER_DASH} target="_blank" rel="noreferrer">grader attestation ↗</a><span>·</span>
            <span className="mono">every score enclave-signed</span>
          </div>
        </section>

        <section id="benchmark">
          <div className="eyebrow">The benchmark</div>
          <h2>Route smart, spend little — across open models</h2>
          <p className="lede" style={{ marginTop: 12 }}>
            You pick which model handles each request and how (single, confidence-escalate, ratings, remom).
            Every model is open-source and free to call, so the game is <b>quality vs compute</b>.
            The grader runs your policy over {bench?.n_prompts ?? "N"} hidden prompts and scores:
          </p>
          <div className="term" style={{ margin: "16px 0", maxWidth: 520 }}>score = mean(quality) − λ·mean(cost)</div>
          {p && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <span className="pill indigo">λ cost = {p.cost_penalty_lambda}</span>
              <span className="pill">confidence threshold = {p.confidence_threshold}</span>
              <span className="pill">{bench!.n_prompts} hidden prompts</span>
            </div>
          )}
          <p className="muted" style={{ fontSize: 13.5, maxWidth: 720, lineHeight: 1.6 }}>
            <code>price / call</code> is a <b style={{ color: "var(--foreground)" }}>compute-cost proxy</b> — a bigger, stronger model costs more.
            The winning move is to solve each prompt on the smallest model that&apos;s good enough, and escalate to a bigger one only when the quality gain beats the compute it costs.
          </p>
          {bench && (
            <div className="grid2" style={{ marginTop: 16 }}>
              {bench.models.map((m) => (
                <div className="node" key={m.id} style={{ minHeight: 0 }}>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>○ open · {m.id}</div>
                  <div className="kv"><span className="muted">tier</span><span className="v">{m.tier}</span></div>
                  <div className="kv"><span className="muted">compute / call</span><span className="v mono">${m.price_per_call}</span></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="grading">
          <div className="eyebrow">How grading works</div>
          <h2>Sandboxed, hidden, and signed</h2>
          <div style={{ marginTop: 16, maxWidth: 760 }}>
            {[
              ["Sandbox", "Your decide() runs under SES capability isolation in a worker thread inside the grader enclave — no fetch / fs / process, so it can't read or leak the hidden prompts, and a hang is killed by a timeout."],
              ["Hidden set", "The prompts are sealed (KMS-encrypted, decrypt only in the enclave). You never see them, so you can't overfit — write a general rule, not per-prompt hacks."],
              ["Attested score", "The grader signs { policy_hash, eval_set_hash, results_root, score } with a KMS-derived key that only exists inside the measured image. Recover the signer with ethers.verifyMessage — it matches the grader's on-chain Derived Address."],
              ["Verified identity", "Web submissions are gated behind Sign in with GitHub — your score is tied to your verified GitHub login, so nobody can claim the board as you."],
            ].map(([t, d], i) => (
              <div className="step" key={i}>
                <span className="num">{i + 1}</span>
                <div><div style={{ fontWeight: 600, marginBottom: 3 }}>{t}</div><div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>{d}</div></div>
              </div>
            ))}
          </div>
        </section>

        <section id="participate">
          <div className="eyebrow">Participate</div>
          <h2>Compete from the CLI, or the browser</h2>
          <p className="lede" style={{ marginTop: 12 }}>Iterate locally against a public dev set (instant, offline), then submit for an attested score on the hidden set.</p>
          <div className="term" style={{ marginTop: 16 }}>
            <div><span className="p"># install</span></div>
            <div><span className="p">$</span> <span className="c">git clone {REPO} && cd arena-router && npm i -g ./arena</span></div>
            <div style={{ height: 10 }} />
            <div><span className="p"># onboard, iterate, submit</span></div>
            <div><span className="p">$</span> <span className="c">autorouter login &lt;handle&gt;</span></div>
            <div><span className="p">$</span> <span className="c">autorouter clone my-router && cd my-router</span></div>
            <div><span className="p">$</span> <span className="c">autorouter run</span>  <span className="o"># score locally on the public dev set</span></div>
            <div><span className="p">$</span> <span className="c">autorouter submit --note "v1"</span>  <span className="o"># attested score on the hidden set</span></div>
          </div>
          <QuickTry me={me} onDone={loadBoard} />
        </section>

        <section id="leaderboard">
          <div className="eyebrow">Score history</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h2>Leaderboard</h2><span className="spacer" />
            <span className="muted mono" style={{ fontSize: 12 }}>best score per participant · enclave-signed</span>
            <button className="btn outline sm" onClick={loadBoard}>refresh</button>
          </div>
          <div className="card pad" style={{ marginTop: 16 }}>
            {board.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No submissions yet — be the first.</p>}
            {board.map((r) => (
              <div className={`lbrow ${r.rank === 1 ? "top1" : ""}`} key={r.submission_id}>
                <span className="rk">#{r.rank}</span>
                <div><div style={{ fontWeight: 500 }}>{r.participant}</div><div className="muted mono addr">policy {short(r.policy_hash)}</div></div>
                <span className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{r.score}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="muted" style={{ padding: "32px 0 60px", fontSize: 12, borderTop: "1px solid var(--border)" }}>
          Grader runs in Intel TDX on EigenCompute; every score is enclave-signed. <a href={GRADER_DASH} target="_blank" rel="noreferrer">Grader attestation ↗</a> · <a href={REPO} target="_blank" rel="noreferrer">Source ↗</a>
        </footer>
      </main>
    </>
  );
}

function AuthPill({ me }: { me: Session }) {
  if (me === "loading") return null;
  if (me === "local") return <span className="pill">local dev</span>;
  if (me.login) return (
    <span className="pill" style={{ gap: 8 }}>@{me.login}
      <a className="navlink" style={{ fontSize: 12 }} href="/api/logout">sign out</a>
    </span>
  );
  if (me.configured) return <a className="btn indigo sm" href="/api/auth/login">Sign in with GitHub</a>;
  return <span className="pill">sign-in not configured</span>;
}

// Submit from the browser. Signed-in GitHub users submit as their verified login
// (via /api/submit). Locally / when OAuth isn't configured, fall back to a handle.
function QuickTry({ me, onDone }: { me: Session; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [model, setModel] = useState("");
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<(SubmitResult & { verified: boolean; recovered: string }) | null>(null);

  const gated = me !== "loading" && me !== "local" && me.configured; // GitHub sign-in enforced
  const login = me !== "loading" && me !== "local" ? me.login : null;

  const submit = async () => {
    setErr(""); setRes(null);
    if (gated && !login) { setErr("sign in with GitHub first"); return; }
    if (!gated && !handle.trim()) { setErr("enter a handle"); return; }
    setBusy(true);
    try {
      const url = gated ? "/api/submit" : `${GRADER}/submit`;
      const payload = gated
        ? { policy, note: model ? `model: ${model}` : "" }
        : { policy, participant: handle.trim(), note: model ? `model: ${model}` : "browser" };
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const d: SubmitResult = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `grader ${r.status}`);
      const v = verifyReceipt(d.receipt, d.signature, d.grader_address);
      setRes({ ...d, verified: v.ok, recovered: v.recovered });
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (!open) return <button className="btn outline sm" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>Submit from the browser →</button>;

  return (
    <div className="card pad" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <h3>Submit a policy</h3><span className="spacer" />
        <button className="btn outline sm" onClick={() => setOpen(false)}>close</button>
      </div>

      {gated && !login && (
        <div className="banner" style={{ border: "1px solid var(--border)", marginBottom: 12 }}>
          <div>Web submissions require a verified identity. <a className="btn indigo sm" href="/api/auth/login" style={{ marginLeft: 8 }}>Sign in with GitHub</a></div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {gated
          ? login && <span className="pill">submitting as @{login}</span>
          : <input className="input" style={{ flex: 1, minWidth: 140, borderColor: handle.trim() ? undefined : "var(--destructive)" }} placeholder="handle (required)" value={handle} onChange={(e) => setHandle(e.target.value)} />}
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="AI model you used (e.g. Claude Opus 4.8)" value={model} onChange={(e) => setModel(e.target.value)} />
      </div>

      <textarea className="textarea mono" style={{ minHeight: 200, fontSize: 12 }} value={policy} onChange={(e) => setPolicy(e.target.value)} spellCheck={false} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button className="btn indigo" onClick={submit} disabled={busy || (gated && !login) || (!gated && !handle.trim())}>
          {busy ? "Grading in the TEE…" : "Submit → attested score"}
        </button>
        <button className="btn outline sm" onClick={() => setPolicy(DEFAULT_POLICY)}>reset</button>
      </div>
      {err && <p className="mono" style={{ color: "var(--destructive)", fontSize: 12, marginTop: 8 }}>error: {err}</p>}
      {res && (
        <div className={`banner ${res.verified ? "ok" : "bad"}`} style={{ marginTop: 12 }}>
          <b style={{ fontSize: 18 }}>{res.verified ? "✓" : "✗"}</b>
          <div><div style={{ fontWeight: 700 }}>SCORE {res.score} · quality {res.mean_quality} · compute ${res.mean_cost}{res.invalid ? ` · ${res.invalid} invalid` : ""}</div>
            <div className="mono" style={{ fontSize: 11 }}>{res.verified ? `signed by grader ${short(res.recovered)}` : "signature failed"}</div></div>
        </div>
      )}
    </div>
  );
}

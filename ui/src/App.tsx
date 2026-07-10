import { useEffect, useState } from "react";
import {
  verifyReceipt, short, DEFAULT_POLICY,
  type Benchmark, type LeaderRow, type SubmitResult,
} from "./arena";

// On Vercel, /api proxies to the grader (see vercel.json). Locally, hit it directly.
const API = import.meta.env.VITE_API_BASE || "http://34.136.240.56:8080";
const REPO = "https://github.com/zeeshan8281/arena-router";
const GRADER_DASH = "https://verify-sepolia.eigencloud.xyz/app/0xa2b59f7988Dc1611d5df3F1FcDf3080daa50d2De";

export default function App() {
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const loadBoard = () => fetch(`${API}/leaderboard`).then((r) => r.json()).then((d) => setBoard(d.leaderboard || [])).catch(() => {});
  useEffect(() => { fetch(`${API}/benchmark`).then((r) => r.json()).then(setBench).catch(() => {}); loadBoard(); }, []);

  const p = bench?.scoring_params;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

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
            <span className="navlink" onClick={() => go("grading")}>How grading works</span>
            <span className="navlink" onClick={() => go("participate")}>Participate</span>
            <span className="navlink" onClick={() => go("leaderboard")}>Score history</span>
            <a className="navlink" href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
          </nav>
        </div>
      </header>

      <main className="wrap">
        {/* hero */}
        <section style={{ paddingTop: 64, borderTop: "none" }}>
          <div className="eyebrow">Attested routing benchmark · Intel TDX on EigenCompute</div>
          <h1 className="hero-h">AutoRouter Arena</h1>
          <p className="lede" style={{ marginTop: 18 }}>
            Build the best LLM routing policy. You submit one function; an attested grader scores it on a
            <b style={{ color: "var(--foreground)" }}> hidden</b> prompt set inside a TEE and
            <b style={{ color: "var(--foreground)" }}> signs</b> the result — so the leaderboard is verifiable and no one,
            not even the organizer, can fake a number.
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

        {/* the benchmark */}
        <section id="benchmark">
          <div className="eyebrow">The benchmark</div>
          <h2>Route smart, spend little, prefer open models</h2>
          <p className="lede" style={{ marginTop: 12 }}>
            You write <span className="mono">decide(prompt, models)</span> — pick which model handles each request and how
            (single, confidence-escalate, ratings, remom). The grader runs it over {bench?.n_prompts ?? "N"} hidden prompts and scores:
          </p>
          <div className="term" style={{ margin: "16px 0", maxWidth: 520 }}>score = mean(quality) − λ·mean(cost) + β·oss_rate</div>
          {p && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <span className="pill indigo">λ cost = {p.cost_penalty_lambda}</span>
              <span className="pill indigo">β openness = {p.openness_bonus_beta}</span>
              <span className="pill">confidence threshold = {p.confidence_threshold}</span>
              <span className="pill">{bench!.n_prompts} hidden prompts</span>
            </div>
          )}
          <p className="muted" style={{ fontSize: 13.5, maxWidth: 720, lineHeight: 1.6 }}>
            Free / open-source models cost 0 <b style={{ color: "var(--foreground)" }}>and</b> earn the openness bonus — so the
            winning move is to solve it on a free OSS model whenever it&apos;s good enough, and only spend on a proprietary model when the quality gain beats the cost.
          </p>
          {bench && (
            <div className="grid2" style={{ marginTop: 16 }}>
              {bench.models.map((m) => (
                <div className="node" key={m.id} style={{ minHeight: 0 }}>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{m.open_source ? "○ open" : "● proprietary"} · {m.id}</div>
                  <div className="kv"><span className="muted">tier</span><span className="v">{m.tier}</span></div>
                  <div className="kv"><span className="muted">price / call</span><span className="v mono">${m.price_per_call}</span></div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* how grading works */}
        <section id="grading">
          <div className="eyebrow">How grading works</div>
          <h2>Sandboxed, hidden, and signed</h2>
          <div style={{ marginTop: 16, maxWidth: 760 }}>
            {[
              ["Sandbox", "Your decide() runs under SES capability isolation in a worker thread inside the grader enclave — no fetch / fs / process, so it can't read or leak the hidden prompts, and a hang is killed by a timeout."],
              ["Hidden set", "The prompts are sealed (KMS-encrypted, decrypt only in the enclave). You never see them, so you can't overfit — write a general rule, not per-prompt hacks."],
              ["Attested score", "The grader signs { policy_hash, eval_set_hash, results_root, score } with a KMS-derived key that only exists inside the measured image. Recover the signer with ethers.verifyMessage — it matches the grader's on-chain Derived Address."],
              ["Auditable", "After the round the hidden set is revealed and eval_set_hash checked, so any score can be recomputed and audited end-to-end. Nothing to trust, everything to verify."],
            ].map(([t, d], i) => (
              <div className="step" key={i}>
                <span className="num">{i + 1}</span>
                <div><div style={{ fontWeight: 600, marginBottom: 3 }}>{t}</div><div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>{d}</div></div>
              </div>
            ))}
          </div>
        </section>

        {/* participate */}
        <section id="participate">
          <div className="eyebrow">Participate</div>
          <h2>Compete from the CLI</h2>
          <p className="lede" style={{ marginTop: 12 }}>Iterate locally against a public dev set (instant, offline), then submit for an attested score on the hidden set.</p>
          <div className="term" style={{ marginTop: 16 }}>
            <div><span className="p"># install</span></div>
            <div><span className="p">$</span> <span className="c">git clone {REPO} && cd arena-router && npm i -g ./arena</span></div>
            <div style={{ height: 10 }} />
            <div><span className="p"># onboard</span></div>
            <div><span className="p">$</span> <span className="c">autorouter login &lt;handle&gt;</span></div>
            <div><span className="p">$</span> <span className="c">autorouter benchmark</span>  <span className="o"># models, params, hidden-set hash</span></div>
            <div><span className="p">$</span> <span className="c">autorouter clone my-router && cd my-router</span></div>
            <div style={{ height: 10 }} />
            <div><span className="p"># iterate, then submit</span></div>
            <div><span className="p">$</span> <span className="c">autorouter run</span>  <span className="o"># score locally on the public dev set</span></div>
            <div><span className="p">$</span> <span className="c">autorouter submit --note "v1"</span>  <span className="o"># attested score on the hidden set</span></div>
            <div><span className="p">$</span> <span className="c">autorouter leaderboard</span></div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Prefer an AI pair? Load the skill — <span className="mono">cp -r arena/skill/autorouter ~/.claude/skills/</span> — and Claude drives the loop with you.
          </p>
          <QuickTry />
        </section>

        {/* leaderboard */}
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

// Optional: submit straight from the browser (no install). Collapsed by default.
function QuickTry() {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<(SubmitResult & { verified: boolean; recovered: string }) | null>(null);

  const submit = async () => {
    if (!handle.trim()) { setErr("pick a handle"); return; }
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ policy, participant: handle.trim(), note: "browser" }) });
      const d: SubmitResult = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `grader ${r.status}`);
      const { ok, recovered } = verifyReceipt(d.receipt, d.signature, d.grader_address);
      setRes({ ...d, verified: ok, recovered });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (!open) return <button className="btn outline sm" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>No install? Try in the browser →</button>;
  return (
    <div className="card pad" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <h3>Quick try — submit from the browser</h3><span className="spacer" />
        <button className="btn outline sm" onClick={() => setOpen(false)}>close</button>
      </div>
      <input className="input" style={{ marginBottom: 8, borderColor: handle.trim() ? undefined : "var(--destructive)" }} placeholder="your handle (required)" value={handle} onChange={(e) => setHandle(e.target.value)} />
      <textarea className="textarea mono" style={{ minHeight: 200, fontSize: 12 }} value={policy} onChange={(e) => setPolicy(e.target.value)} spellCheck={false} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button className="btn indigo" onClick={submit} disabled={busy || !handle.trim()}>{busy ? "Grading in the TEE…" : "Submit → attested score"}</button>
        <button className="btn outline sm" onClick={() => setPolicy(DEFAULT_POLICY)}>reset</button>
        {!handle.trim() && <span className="muted" style={{ fontSize: 12 }}>← enter a handle to submit</span>}
      </div>
      {err && <p className="mono" style={{ color: "var(--destructive)", fontSize: 12, marginTop: 8 }}>error: {err}</p>}
      {res && (
        <div className={`banner ${res.verified ? "ok" : "bad"}`} style={{ marginTop: 12 }}>
          <b style={{ fontSize: 18 }}>{res.verified ? "✓" : "✗"}</b>
          <div><div style={{ fontWeight: 700 }}>SCORE {res.score} · quality {res.mean_quality} · cost ${res.mean_cost} · oss {(res.oss_rate * 100).toFixed(0)}%</div>
            <div className="mono" style={{ fontSize: 11 }}>{res.verified ? `signed by grader ${short(res.recovered)}` : "signature failed"}</div></div>
        </div>
      )}
    </div>
  );
}

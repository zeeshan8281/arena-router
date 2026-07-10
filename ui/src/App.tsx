import { useEffect, useState } from "react";
import {
  verifyReceipt, short, DEFAULT_POLICY,
  type Benchmark, type LeaderRow, type SubmitResult,
} from "./arena";

// On Vercel, /api proxies to the grader (see vercel.json). Locally, hit it directly.
const API = import.meta.env.VITE_API_BASE || "http://34.136.240.56:8080";
const REPO = "https://github.com/zeeshan8281/arena-router";

export default function App() {
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [handle, setHandle] = useState(localStorage.getItem("handle") || "");
  const [policy, setPolicy] = useState(localStorage.getItem("policy") || DEFAULT_POLICY);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<(SubmitResult & { verified: boolean; recovered: string }) | null>(null);

  const loadBench = () => fetch(`${API}/benchmark`).then((r) => r.json()).then(setBench).catch(() => setErr("Can't reach the grader."));
  const loadBoard = () => fetch(`${API}/leaderboard`).then((r) => r.json()).then((d) => setBoard(d.leaderboard || [])).catch(() => {});
  useEffect(() => { loadBench(); loadBoard(); /* eslint-disable-next-line */ }, []);

  const submit = async () => {
    if (!handle.trim()) { setErr("Pick a handle first."); return; }
    setBusy(true); setErr(""); setResult(null);
    localStorage.setItem("handle", handle); localStorage.setItem("policy", policy);
    try {
      const res = await fetch(`${API}/submit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy, participant: handle.trim(), note }),
      });
      const d: SubmitResult = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || `grader ${res.status}`);
      const { ok, recovered } = verifyReceipt(d.receipt, d.signature, d.grader_address);
      setResult({ ...d, verified: ok, recovered });
      loadBoard();
    } catch (e: any) {
      setErr(e.message || "submit failed");
    } finally {
      setBusy(false);
    }
  };

  const p = bench?.scoring_params;

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
          <span className="pill indigo">EigenCompute · Sepolia · Intel TDX</span>
          {result?.grader_address && <span className="pill">grader {short(result.grader_address)}</span>}
          <a className="pill" href={REPO} target="_blank" rel="noreferrer">Repo ↗</a>
        </div>
      </header>

      <main className="wrap" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <div style={{ maxWidth: 760 }}>
          <span className="pill indigo" style={{ marginBottom: 16 }}>Attested routing competition</span>
          <h1>Build the best routing policy.<br />Get a score you can&apos;t fake.</h1>
          <p className="muted" style={{ fontSize: 15.5, marginTop: 16, lineHeight: 1.6 }}>
            You write one function — <span className="mono">decide()</span>. An attested grader runs it in a
            sandbox against a <b style={{ color: "var(--foreground)" }}>hidden</b> prompt set inside a TEE and
            <b style={{ color: "var(--foreground)" }}> signs</b> your score. The leaderboard is verifiable —
            no one, not even the organizer, can fake a number.
          </p>
        </div>

        {/* objective / benchmark */}
        <div className="card pad" style={{ marginTop: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h2>The benchmark</h2>
            <span className="spacer" />
            {bench && <span className="muted mono" style={{ fontSize: 12 }}>{bench.n_prompts} hidden prompts · eval_set_hash {short(bench.eval_set_hash)}</span>}
          </div>
          <div className="codebox" style={{ height: "auto", margin: "12px 0" }}>
            score = mean(quality) − λ·mean(cost) + β·oss_rate
          </div>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 14px" }}>
            Free / open‑source models cost 0 <b style={{ color: "var(--foreground)" }}>and</b> earn the openness bonus.
            Route to a free OSS model whenever it&apos;s good enough; only spend on a proprietary model when the quality gain beats the cost.
          </p>
          {p && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <span className="pill indigo">λ (cost) = {p.cost_penalty_lambda}</span>
            <span className="pill indigo">β (openness) = {p.openness_bonus_beta}</span>
            <span className="pill">confidence threshold = {p.confidence_threshold}</span>
          </div>}
          {bench && <div className="pipe" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {bench.models.map((m) => (
              <div className="node" key={m.id} style={{ minHeight: 0 }}>
                <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{m.open_source ? "○" : "●"} {m.id}</div>
                <div className="kv"><span className="muted">tier</span><span className="v">{m.tier}</span></div>
                <div className="kv"><span className="muted">price/call</span><span className="v mono">${m.price_per_call}</span></div>
              </div>
            ))}
          </div>}
        </div>

        <div className="grid2" style={{ marginTop: 18 }}>
          {/* submit */}
          <div className="card pad">
            <h3 style={{ marginBottom: 12 }}>Submit a policy</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="your handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
              <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <textarea className="textarea mono" style={{ minHeight: 240, fontSize: 12 }} value={policy} onChange={(e) => setPolicy(e.target.value)} spellCheck={false} />
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              <button className="btn indigo" onClick={submit} disabled={busy}>
                {busy ? <><span className="spin" style={{ display: "inline-block" }}>◠</span> Grading in the TEE…</> : "Submit → attested score"}
              </button>
              <button className="btn outline sm" onClick={() => setPolicy(DEFAULT_POLICY)}>reset template</button>
            </div>
            {err && <p className="mono" style={{ color: "var(--destructive)", fontSize: 12, marginTop: 10 }}>error: {err}</p>}

            {result && (
              <div className="fade" style={{ marginTop: 14 }}>
                <div className={`banner ${result.verified ? "ok" : "bad"}`}>
                  <b style={{ fontSize: 20 }}>{result.verified ? "✓" : "✗"}</b>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>SCORE {result.score}</div>
                    <div className="mono" style={{ fontSize: 11.5 }}>
                      {result.verified ? `signed by grader enclave ${short(result.recovered)}` : "signature did not verify"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <span className="pill">quality {result.mean_quality}</span>
                  <span className="pill">cost ${result.mean_cost}</span>
                  <span className="pill">oss {(result.oss_rate * 100).toFixed(0)}%</span>
                  {result.invalid > 0 && <span className="pill bad">invalid {result.invalid}</span>}
                </div>
                <p className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>submission {result.submission_id}</p>
              </div>
            )}
          </div>

          {/* leaderboard */}
          <div className="card pad">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <h3>Leaderboard</h3><span className="spacer" />
              <button className="btn outline sm" onClick={loadBoard}>refresh</button>
            </div>
            {board.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No submissions yet — be the first.</p>}
            {board.map((r) => (
              <div className="vrow" key={r.submission_id}>
                <span className="pill" style={{ minWidth: 34, justifyContent: "center" }}>#{r.rank}</span>
                <div className="grow"><div style={{ fontWeight: 500 }}>{r.participant}</div>
                  <div className="muted mono addr">policy {short(r.policy_hash)}</div></div>
                <span className="mono" style={{ fontWeight: 700 }}>{r.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card pad" style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 10 }}>Why the score can&apos;t be gamed</h3>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
            Your <span className="mono">decide()</span> runs under SES capability isolation in the grader enclave —
            no <span className="mono">fetch</span>/<span className="mono">fs</span>/<span className="mono">process</span>, so it can&apos;t read or leak the hidden prompts. The score is signed by a
            KMS‑derived key that only exists inside the measured image, and the receipt commits to
            <span className="mono"> policy_hash</span>, <span className="mono">eval_set_hash</span> and a root of per‑prompt results — so it&apos;s recomputable and
            auditable after the set is revealed. Prefer the CLI for serious iteration:
            {" "}<span className="mono">npm i -g ./arena && autorouter run</span>. <a href={REPO} target="_blank" rel="noreferrer">Repo ↗</a>
          </p>
        </div>
      </main>
    </>
  );
}

import { useEffect, useState } from "react";
import { verifyChain, short, type Bundle, type Receipt } from "./verify";

const DEFAULT_CONDUCTOR = "http://34.143.160.145:8080";
const DASHBOARD = "https://verify-sepolia.eigencloud.xyz/app/0x7F2EC821fbD68e8A20C7C01a9498b6C70bC9c896";

const EXAMPLES = [
  "say hi in one word",
  "Write a Python function for the nth Fibonacci number. ```py``` Why is recursion slow? How to fix it?",
  "Translate 'good morning' to Japanese and explain the politeness level.",
];

type Health = { ok: boolean; signer: string; policy_hash: string };

export default function App() {
  const [base, setBase] = useState(localStorage.getItem("conductor") || DEFAULT_CONDUCTOR);
  const [health, setHealth] = useState<Health | null>(null);
  const [connErr, setConnErr] = useState("");
  const [prompt, setPrompt] = useState(EXAMPLES[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [tampered, setTampered] = useState(false);

  const connect = async (b = base) => {
    setConnErr(""); setHealth(null);
    try {
      const h = await fetch(`${b}/health`).then((r) => r.json());
      setHealth(h); localStorage.setItem("conductor", b);
    } catch {
      setConnErr("Could not reach the conductor. Check the URL (its public IP can change on restart).");
    }
  };
  useEffect(() => { connect(); /* eslint-disable-next-line */ }, []);

  const route = async () => {
    setBusy(true); setError(""); setBundle(null); setAnswer(""); setTampered(false);
    try {
      const res = await fetch(`${base}/v1/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: 220 }),
      });
      if (!res.ok) throw new Error(`conductor ${res.status}`);
      const out = await res.json();
      setAnswer(out.content || "(empty)");
      // pull the full stored bundle (canonical + signer_address + worker canonicals)
      const b: Bundle = await fetch(`${base}/trace/${out.task_id}`).then((r) => r.json());
      setBundle(b);
    } catch (e: any) {
      setError(e.message || "request failed");
    } finally {
      setBusy(false);
    }
  };

  // Tamper: mutate chosen_model, re-canonicalize against the ORIGINAL signature.
  const shownReceipt: Receipt | undefined = bundle
    ? tampered
      ? { ...bundle.receipt, chosen_model: bundle.receipt.chosen_model + "  ⚠ SWAPPED" }
      : bundle.receipt
    : undefined;
  const result = bundle ? verifyChain(bundle, shownReceipt) : null;

  const r = bundle?.receipt;

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <div className="brandmark">
            <img src="/eigen-icon.svg" alt="Eigen" />
            <span className="divider" />
            <span className="title">Attested Router</span>
          </div>
          <div className="spacer" />
          <span className="pill indigo">EigenCompute · Sepolia · Intel TDX</span>
          <a className="pill" href={DASHBOARD} target="_blank" rel="noreferrer">Dashboard ↗</a>
        </div>
      </header>

      <main className="wrap" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <div style={{ maxWidth: 720 }}>
          <span className="pill indigo" style={{ marginBottom: 16 }}>Verifiable AI routing</span>
          <h1>Verify which model answered.<br />Don&apos;t trust it.</h1>
          <p className="muted" style={{ fontSize: 15.5, marginTop: 16, lineHeight: 1.6 }}>
            A semantic router running inside Intel TDX enclaves. Every routing decision and every
            model inference is signed by an enclave-bound key. Your prompt below is routed live —
            then <b style={{ color: "var(--foreground)" }}>your browser</b> independently recovers
            every signer. No trust in the operator.
          </p>
        </div>

        {/* connection */}
        <div className="card pad" style={{ marginTop: 28 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="k muted" style={{ fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".06em" }}>Conductor endpoint</div>
              <input className="input mono" value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} />
            </div>
            <button className="btn outline" onClick={() => connect()}>Reconnect</button>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pill">
              <span className={`dot ${health ? "live" : "off"}`} />
              {health ? "conductor live" : connErr ? "offline" : "connecting…"}
            </span>
            {health && <span className="muted mono addr">signer {short(health.signer)}</span>}
            {health && <span className="muted mono addr">policy {short(health.policy_hash)}</span>}
          </div>
          {connErr && <p className="mono" style={{ color: "var(--destructive)", fontSize: 12, marginTop: 10 }}>{connErr}</p>}
        </div>

        {/* prompt */}
        <div className="card pad" style={{ marginTop: 16 }}>
          <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask anything…" />
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn indigo" onClick={route} disabled={busy || !health}>
              {busy ? <><span className="spin" style={{ display: "inline-block" }}>◠</span> Routing & attesting…</> : "Route & Attest →"}
            </button>
            <span className="spacer" />
            {EXAMPLES.map((ex, i) => (
              <span key={i} className="pill chip" onClick={() => setPrompt(ex)} title={ex}>
                {ex.length > 34 ? ex.slice(0, 34) + "…" : ex}
              </span>
            ))}
          </div>
          {error && <p className="mono" style={{ color: "var(--destructive)", fontSize: 12, marginTop: 10 }}>error: {error}</p>}
        </div>

        {/* pipeline + verification */}
        {r && result && (
          <div className="fade" style={{ marginTop: 24 }}>
            <h2 style={{ marginBottom: 14 }}>How this answer was produced</h2>
            <div className="pipe">
              <Node k="1 · Observe" title="Signals">
                <KV label="tokens" v={r.signals.token_estimate} />
                <KV label="lang" v={r.signals.detected_lang} />
                <KV label="complexity" v={r.signals.complexity_band} />
                <Arrow />
              </Node>
              <Node k="2 · Decide" title="Policy">
                <KV label="looper" v={r.looper} />
                <KV label="candidates" v={r.candidates_considered.length} />
                <div className="muted mono" style={{ fontSize: 10.5, marginTop: 6 }}>policy {short(r.policy_hash)}</div>
                <Arrow />
              </Node>
              <Node k="3 · Sign" title={<>Conductor <span className="pill indigo" style={{ padding: "1px 6px" }}>✍</span></>} sign>
                <div className="muted mono addr">{short(bundle!.signer_address)}</div>
                <div className="k muted" style={{ marginTop: 8 }}>chose</div>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{r.chosen_model}</div>
                <Arrow />
              </Node>
              <Node k="4 · Attest" title={<>Workers <span className="pill indigo" style={{ padding: "1px 6px" }}>✍</span></>} sign>
                {r.worker_attestations.map((a, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>{a.model_id}</div>
                    <div className="muted mono addr">{short(a.worker_address)}</div>
                  </div>
                ))}
              </Node>
            </div>

            {/* the payoff: client-side verification */}
            <div className="card pad" style={{ marginTop: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <h3>Signature check — running in your browser (ethers.verifyMessage)</h3>
                <span className="spacer" />
                <button className={`btn sm ${tampered ? "indigo" : "outline"}`} onClick={() => setTampered((t) => !t)}>
                  {tampered ? "↺ Restore receipt" : "⚠ Tamper: swap chosen_model"}
                </button>
              </div>

              <div className={`banner ${result.allOk && result.receiptMatchesSigned ? "ok" : "bad"}`} style={{ marginBottom: 12 }}>
                <b style={{ fontSize: 18 }}>{result.allOk && result.receiptMatchesSigned ? "✓" : "✗"}</b>
                <div>
                  {result.allOk && result.receiptMatchesSigned
                    ? "CHAIN VERIFIED — the decision and every inference are signed by real enclave keys."
                    : tampered
                      ? "REJECTED — one byte changed and the recovered signer no longer matches. The receipt is provably unaltered."
                      : "VERIFICATION FAILED."}
                </div>
              </div>

              {!result.receiptMatchesSigned && (
                <div className="vrow"><span className="pill bad">receipt ≠ signed bytes</span>
                  <span className="muted grow" style={{ fontSize: 12 }}>the displayed receipt no longer canonicalizes to what was signed</span></div>
              )}

              {result.checks.map((c, i) => (
                <div className="vrow" key={i}>
                  <span className={`pill ${c.ok ? "ok" : "bad"}`}>{c.ok ? "✓" : "✗"}</span>
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>
                      {c.role === "conductor" ? "Conductor receipt" : `Worker · ${c.model}`}
                    </div>
                    <div className="muted mono addr">
                      recovered {short(c.recovered)} {c.ok ? "=" : "≠"} expected {short(c.expected)}
                    </div>
                  </div>
                  <span className="pill">{c.role}</span>
                </div>
              ))}
            </div>

            <div className="grid2" style={{ marginTop: 18 }}>
              <div className="card pad">
                <h3 style={{ marginBottom: 10 }}>Answer <span className="muted" style={{ fontWeight: 400 }}>· {r.chosen_model}</span></h3>
                <div className="scrollbox">
                  <p style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{answer}</p>
                </div>
              </div>
              <div className="card pad">
                <h3 style={{ marginBottom: 10 }}>Signed receipt <span className="muted" style={{ fontWeight: 400 }}>· /trace/{r.task_id.slice(0, 8)}</span></h3>
                <div className="codebox">{JSON.stringify(shownReceipt, null, 2)}</div>
              </div>
            </div>
          </div>
        )}

        <footer className="muted" style={{ marginTop: 60, fontSize: 12, borderTop: "1px solid var(--border)", paddingTop: 20 }}>
          Conductor & workers run in Intel TDX enclaves; keys are KMS-derived and never leave the enclave.
          The worker&apos;s <span className="mono">openai</span> backend attests <i>"this enclave relayed this output for this model_id"</i> —
          on-device weight attestation needs a GPU TEE tier. <a href="https://github.com/zeeshan8281/attested-vllm-router" target="_blank" rel="noreferrer">Source ↗</a>
        </footer>
      </main>
    </>
  );
}

function Node({ k, title, children, sign }: { k: string; title: React.ReactNode; children: React.ReactNode; sign?: boolean }) {
  return (
    <div className={`node ${sign ? "sign" : ""}`}>
      <div className="k">{k}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function KV({ label, v }: { label: string; v: React.ReactNode }) {
  return <div className="kv"><span className="muted">{label}</span><span className="v mono">{v}</span></div>;
}
function Arrow() {
  return <svg className="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h9M9 5l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

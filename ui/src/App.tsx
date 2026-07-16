import { useEffect, useState } from "react";
import {
  fetchLeaderboard, fetchRun, usd,
  type Leaderboard, type LeaderRow, type RunResult,
} from "./arena";

const REPO = "https://github.com/zeeshan8281/arena-router";

// ?run=<id> shows the run-detail view; otherwise the leaderboard.
function runIdFromUrl(): string | null {
  return new URLSearchParams(location.search).get("run");
}

export default function App() {
  const [runId, setRunId] = useState<string | null>(runIdFromUrl());

  useEffect(() => {
    const onPop = () => setRunId(runIdFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (id: string | null) => {
    const url = id ? `?run=${encodeURIComponent(id)}` : location.pathname;
    history.pushState({}, "", url);
    setRunId(id);
  };

  return (
    <div className="wrap">
      <header>
        <h1 onClick={() => go(null)} style={{ cursor: "pointer" }}>AutoRouter&nbsp;Arena</h1>
        <p className="tagline">
          Make an AI coding agent as cheap as possible without making it dumber ·{" "}
          <a href={REPO}>source</a>
        </p>
      </header>
      {runId ? <RunView id={runId} onBack={() => go(null)} /> : <BoardView onOpen={go} />}
    </div>
  );
}

function BoardView({ onOpen }: { onOpen: (id: string) => void }) {
  const [lb, setLb] = useState<Leaderboard | null | "loading">("loading");
  useEffect(() => { fetchLeaderboard().then((d) => setLb(d)); }, []);

  if (lb === "loading") return <p className="muted">loading leaderboard…</p>;
  if (!lb) return <Empty />;

  return (
    <>
      <section className="baseline">
        {lb.baseline ? (
          <>Baseline (vanilla&nbsp;pi&nbsp;+&nbsp;GLM&nbsp;5.2): <b>{lb.baseline.pass}</b> passed at{" "}
            <b>{usd(lb.baseline.cost_usd)}</b>. Eligibility bar: <b>{lb.eligibility_bar}</b> passed.</>
        ) : (
          <>Baseline probe not yet run — the eligibility bar is unfrozen.</>
        )}
      </section>

      <h2>Ranked — cheapest qualifying harness wins</h2>
      {Array.isArray(lb.ranked) && lb.ranked.length ? (
        <table>
          <thead><tr><th>#</th><th>author</th><th>entry</th><th>passed</th><th className="num">billed&nbsp;$</th></tr></thead>
          <tbody>
            {lb.ranked.map((e) => <Row key={e.run_id ?? e.participant} e={e} onOpen={onOpen} rank />)}
          </tbody>
        </table>
      ) : <p className="muted">No qualified entries yet.</p>}

      {Array.isArray(lb.below_bar) && lb.below_bar.length > 0 && (
        <>
          <h3>Below the bar</h3>
          <table>
            <thead><tr><th>author</th><th>entry</th><th>passed</th></tr></thead>
            <tbody>
              {lb.below_bar.map((e) => (
                <tr key={e.run_id ?? e.participant} className="dim">
                  <td>{e.participant}</td><td>{e.entry_name ?? ""}</td><td>{e.pass}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function Row({ e, onOpen, rank }: { e: LeaderRow; onOpen: (id: string) => void; rank?: boolean }) {
  const clickable = Boolean(e.run_id);
  return (
    <tr className={clickable ? "link" : ""} onClick={() => e.run_id && onOpen(e.run_id)}>
      {rank && <td>{e.rank ?? "—"}</td>}
      <td>{e.participant}</td>
      <td>{e.entry_name ?? ""}</td>
      <td>{e.pass}</td>
      <td className="num">{usd(e.cost_usd)}</td>
    </tr>
  );
}

function RunView({ id, onBack }: { id: string; onBack: () => void }) {
  const [run, setRun] = useState<RunResult | null | "loading">("loading");
  useEffect(() => { fetchRun(id).then((d) => setRun(d)); }, [id]);

  if (run === "loading") return <p className="muted">loading run…</p>;
  if (!run) return (<><a className="back" onClick={onBack}>← leaderboard</a><Empty run={id} /></>);

  const t0 = run.trials?.[0] ?? { pass_vector: {} as Record<string, boolean>, pass_count: 0, billed_usd: 0 };
  const voided = run.validity?.voided;
  const flags = run.anomaly_flags ?? [];
  return (
    <>
      <a className="back" onClick={onBack}>← leaderboard</a>
      <h2>
        {run.run_id} <span className="tag">{run.run_type}</span>{" "}
        <span className={`badge ${voided ? "void" : "ok"}`}>{voided ? "VOID" : "valid"}</span>
      </h2>
      <p className="muted">
        author <b>{run.author}</b>{run.entry_name ? <> · entry <b>{run.entry_name}</b></> : null} ·
        pi {run.pi_version ?? "?"} · passed <b>{run.median_pass_count}</b> ·
        billed <b>{usd(run.median_billed_usd)}</b>
      </p>
      <div className="grid">
        {Object.entries(t0.pass_vector ?? {}).map(([task, ok]) => (
          <span key={task} className={`cell ${ok ? "pass" : "fail"}`} title={task}>{task}</span>
        ))}
        {!Object.keys(t0.pass_vector ?? {}).length && <span className="muted">no per-task data</span>}
      </div>
      {flags.length > 0 && <p className="anom">⚠ {flags.length} anomaly flag(s)</p>}
    </>
  );
}

function Empty({ run }: { run?: string }) {
  return (
    <section className="empty">
      <p>{run ? `Run ${run} not found.` : "No leaderboard yet."}</p>
      <p className="muted">
        Results appear here once the pipeline runs (baseline probe → smoke → full).
        Progress: <a href={`${REPO}/blob/v2/docs/IMPLEMENTED.md`}>IMPLEMENTED.md</a>.
      </p>
    </section>
  );
}

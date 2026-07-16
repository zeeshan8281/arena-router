// v2 UI data layer — reads the static results/ JSON the pipeline commits (spec §7.3).
// No grader, no receipts, no ethers: the score is OpenRouter billed dollars, and the
// audit trail is the generation IDs in each run file.

const BASE =
  import.meta.env.VITE_RESULTS_BASE ||
  "https://raw.githubusercontent.com/zeeshan8281/arena-router/v2";

export interface LeaderRow {
  rank: number | null;
  participant: string;
  entry_name?: string | null;
  pass: number;
  cost_usd: number;
  qualified?: boolean;
  run_id?: string;
}

export interface Leaderboard {
  schema_version: number;
  eligibility_bar: number;
  baseline: { pass: number; cost_usd: number; run_id: string } | null;
  ranked: LeaderRow[];
  below_bar: LeaderRow[];
}

export interface Trial {
  pass_vector?: Record<string, boolean>;
  pass_count: number;
  billed_usd: number;
}

export interface RunResult {
  run_id: string;
  run_type: "smoke" | "full" | "baseline";
  author: string;
  entry_name?: string | null;
  pi_version?: string | null;
  median_pass_count: number;
  median_billed_usd: number;
  trials: Trial[];
  validity?: { voided?: boolean; void_reason?: unknown };
  anomaly_flags?: unknown[];
}

export const usd = (n: number) => `$${Number(n).toFixed(4)}`;

export async function fetchLeaderboard(): Promise<Leaderboard | null> {
  try {
    const r = await fetch(`${BASE}/results/leaderboard.json`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Leaderboard;
  } catch {
    return null;
  }
}

export async function fetchRun(id: string): Promise<RunResult | null> {
  try {
    const r = await fetch(`${BASE}/results/runs/${id}.json`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as RunResult;
  } catch {
    return null;
  }
}

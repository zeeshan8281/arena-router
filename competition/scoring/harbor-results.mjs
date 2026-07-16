// Parse Harbor's top-level result.json into the { passed, passVector } shape the
// scoring code (score.mjs aggregate()) consumes. This is the harbor→scoring seam
// the original handoff flagged as "NOT YET BUILT". Cost is NOT here — billed dollars
// come from the OpenRouter ledger (ledger/openrouter.mjs), keyed by the per-run key.
//
// Harbor emits pass/fail under stats.evals.<eval>.reward_stats.reward, mapping each
// reward value (string) → the task instances that scored it. TB2 rewards are binary
// (1.0 solved / 0.0 not). A task instance id is "<task-name>__<suffix>".

/** task instance id "fix-git__m84xLVm" → "fix-git" */
export function taskNameOf(instanceId) {
  return instanceId.split("__")[0];
}

/**
 * Parse a Harbor result.json object.
 * Returns { n_trials, n_errors, passVector: {task: bool}, passed: <int> }.
 * `passed` = distinct tasks with reward ≥ 1.0. Correct for single-trial runs
 * (full run is 1 trial, D14). Smoke median-of-3 needs per-trial breakdown — see NOTE.
 */
export function parseHarborResult(result) {
  const stats = result?.stats ?? {};
  const evals = stats.evals ?? {};

  const passVector = {};
  for (const ev of Object.values(evals)) {
    const byReward = ev?.reward_stats?.reward ?? {};
    for (const [rewardStr, instances] of Object.entries(byReward)) {
      const solved = Number(rewardStr) >= 1.0;
      for (const inst of instances) {
        const task = taskNameOf(inst);
        // If a task shows up under multiple reward buckets (multi-trial), any solve counts.
        passVector[task] = (passVector[task] ?? false) || solved;
      }
    }
  }

  const passed = Object.values(passVector).filter(Boolean).length;
  return {
    n_trials: stats.n_trials ?? result?.n_total_trials ?? 0,
    n_errors: stats.n_errors ?? 0,
    passVector,
    passed,
  };
}

// NOTE (smoke median-of-3): the top-level result.json aggregates across trials, so
// per-trial pass counts aren't recoverable here. When a key enables a real 3-trial run,
// extend this to read the per-trial result files; until then full-run (single trial) is
// exact and smoke should parse each trial's own result.json.

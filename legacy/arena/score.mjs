// Shared local scoring — used by run.mjs and the CLI. A precomputed-outcome
// PROXY of the live grader (src/grader/score.ts): same MULTI-STAGE routing, but
// per-stage quality/confidence come from a table so it runs offline and instant.
// It predicts the grader (routing), it doesn't reproduce it (no live inference).

// One stage's looper over precomputed per-stage outcomes.
export function simulateStage(dec, outcomes, thresh, byId) {
  const cand = (dec?.candidates ?? []).filter((id) => byId[id] && outcomes[id]);
  if (!cand.length) return { invalid: true };
  const q = (id) => outcomes[id].quality;
  const conf = (id) => outcomes[id].confidence;
  switch (dec.looper) {
    case "single": return { chosen: cand[0], called: [cand[0]] };
    case "confidence": {
      const called = [];
      for (const id of cand) { called.push(id); if (conf(id) >= thresh) return { chosen: id, called }; }
      return { chosen: called[called.length - 1], called };
    }
    case "ratings": return { chosen: [...cand].sort((a, b) => q(b) - q(a))[0], called: cand };
    case "remom": {
      const best = Math.max(...cand.map(q));
      return { chosen: cand[0], called: [...cand, cand[0]], qualityOverride: Math.min(1, best + 0.03) };
    }
    default: return { invalid: true };
  }
}

/** decideFn: (promptView, models) => Decision. `tasks` are multi-stage. */
export function scorePolicy(decideFn, tasks, catalog) {
  const { cost_penalty_lambda: L, openness_bonus_beta: B, confidence_threshold: T } = catalog.scoring;
  const byId = Object.fromEntries(catalog.models.map((m) => [m.id, m]));
  const rows = [];
  let sumQ = 0, sumC = 0, oss = 0, invalid = 0;

  for (const t of tasks) {
    const called = [], chosen = [], stageQ = [];
    let bad = false;
    for (let i = 0; i < t.stages.length; i++) {
      const st = t.stages[i];
      let dec = null;
      try { dec = decideFn({ id: `${t.id}::${st.id}`, text: st.prompt, signals: st.signals, stage: { kind: st.kind, index: i, total: t.stages.length } }, catalog.models); } catch {}
      const sim = simulateStage(dec, st.outcomes, T, byId);
      if (sim.invalid) { bad = true; break; }
      stageQ.push(sim.qualityOverride ?? st.outcomes[sim.chosen].quality);
      called.push(...sim.called); chosen.push(sim.chosen);
    }
    if (bad || !stageQ.length) { invalid++; rows.push({ id: t.id, chosen: "INVALID", stages: t.stages.length, calls: 0, quality: 0, cost: 0, oss: false }); continue; }
    const quality = stageQ.reduce((a, b) => a + b, 0) / stageQ.length; // proxy: mean stage quality
    const cost = called.reduce((s, id) => s + byId[id].price_per_call, 0);
    const isOss = chosen.every((id) => byId[id].open_source);
    sumQ += quality; sumC += cost; if (isOss) oss++;
    rows.push({ id: t.id, chosen: chosen.join(" › "), stages: t.stages.length, calls: called.length, quality, cost, oss: isOss });
  }
  const n = tasks.length;
  const mean_quality = sumQ / n, mean_cost = sumC / n, oss_rate = oss / n;
  return { rows, mean_quality, mean_cost, oss_rate, invalid, score: mean_quality - L * mean_cost + B * oss_rate, params: { L, B, T } };
}

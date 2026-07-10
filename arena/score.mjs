// Shared local scoring — used by run.mjs and the CLI. Mirrors the grader's
// src/grader/score.ts exactly (keep them in sync).

export function simulate(dec, outcomes, thresh, byId) {
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
    // aggregator (cand[0]) IS the final answer — quality/cost/openness attribute
    // to it. No best-of-all bonus (that let you buy a strong model's quality
    // while crediting a cheap open model). You still pay for every model called.
    case "remom": return { chosen: cand[0], called: [...cand, cand[0]] };
    default: return { invalid: true };
  }
}

/** decideFn: (promptView, models) => Decision */
export function scorePolicy(decideFn, prompts, catalog) {
  const { cost_penalty_lambda: L, openness_bonus_beta: B, confidence_threshold: T } = catalog.scoring;
  const byId = Object.fromEntries(catalog.models.map((m) => [m.id, m]));
  const rows = [];
  let sumQ = 0, sumC = 0, oss = 0, invalid = 0;
  for (const p of prompts) {
    let dec = null;
    try { dec = decideFn({ id: p.id, text: p.text, signals: p.signals }, catalog.models); } catch {}
    const sim = simulate(dec, p.outcomes, T, byId);
    if (sim.invalid) { invalid++; rows.push({ id: p.id, looper: dec?.looper ?? "—", chosen: "INVALID", called: 0, quality: 0, cost: 0, oss: false }); continue; }
    const quality = p.outcomes[sim.chosen].quality;
    const cost = sim.called.reduce((s, id) => s + byId[id].price_per_call, 0);
    const isOss = byId[sim.chosen].open_source;
    sumQ += quality; sumC += cost; if (isOss) oss++;
    rows.push({ id: p.id, looper: dec.looper, chosen: sim.chosen, called: sim.called.length, quality, cost, oss: isOss });
  }
  const n = prompts.length;
  const mean_quality = sumQ / n, mean_cost = sumC / n, oss_rate = oss / n;
  return { rows, mean_quality, mean_cost, oss_rate, invalid, score: mean_quality - L * mean_cost + B * oss_rate, params: { L, B, T } };
}

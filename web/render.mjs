// Pure render helpers for the v2 static web views (spec §7.3). No framework, no build —
// leaderboard.html / run.html import these and wire fetch + DOM. Kept pure so they're
// node-testable without a browser.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const usd = (n) => `$${Number(n).toFixed(4)}`;

/** results/leaderboard.json → HTML. Ranked cheapest-first, baseline pinned, below-bar shown. */
export function renderLeaderboard(lb) {
  if (!lb || !Array.isArray(lb.ranked)) return `<p class="empty">No leaderboard yet.</p>`;
  const base = lb.baseline
    ? `<p class="baseline">Baseline (vanilla pi + GLM 5.2): <b>${esc(lb.baseline.pass)}</b> passed at <b>${usd(lb.baseline.cost_usd)}</b>. Eligibility bar: ${esc(lb.eligibility_bar)} passed.</p>`
    : `<p class="baseline">Baseline probe not yet run — eligibility bar unfrozen.</p>`;
  const row = (e) =>
    `<tr><td>${e.rank ?? "—"}</td><td>${esc(e.participant)}</td><td>${esc(e.entry_name ?? "")}</td><td>${esc(e.pass)}</td><td class="cost">${usd(e.cost_usd)}</td></tr>`;
  const ranked = lb.ranked.length
    ? `<table><thead><tr><th>#</th><th>author</th><th>entry</th><th>passed</th><th>billed $</th></tr></thead><tbody>${lb.ranked.map(row).join("")}</tbody></table>`
    : `<p class="empty">No qualified entries yet.</p>`;
  const below =
    (lb.below_bar?.length ?? 0) > 0
      ? `<h3>Below the bar</h3><table><thead><tr><th>author</th><th>entry</th><th>passed</th></tr></thead><tbody>${lb.below_bar
          .map((e) => `<tr><td>${esc(e.participant)}</td><td>${esc(e.entry_name ?? "")}</td><td>${esc(e.pass)}</td></tr>`)
          .join("")}</tbody></table>`
      : "";
  return `${base}${ranked}${below}`;
}

/** results/runs/<id>.json → HTML: pass grid + cost + validity. */
export function renderRun(run) {
  if (!run) return `<p class="empty">Run not found.</p>`;
  const t0 = run.trials?.[0] ?? {};
  const grid = Object.entries(t0.pass_vector ?? {})
    .map(([task, ok]) => `<span class="cell ${ok ? "pass" : "fail"}" title="${esc(task)}">${esc(task)}</span>`)
    .join("");
  const v = run.validity ?? {};
  const badge = v.voided
    ? `<span class="badge void">VOID: ${esc(JSON.stringify(v.void_reason))}</span>`
    : `<span class="badge ok">valid</span>`;
  return `
    <h2>${esc(run.run_id)} <small>${esc(run.run_type)}</small> ${badge}</h2>
    <p>author <b>${esc(run.author)}</b> · pi ${esc(run.pi_version ?? "?")} · passed <b>${esc(run.median_pass_count)}</b> · billed <b>${usd(run.median_billed_usd)}</b></p>
    <div class="grid">${grid || '<span class="empty">no per-task data</span>'}</div>
    ${(run.anomaly_flags?.length ?? 0) ? `<p class="anom">⚠ ${run.anomaly_flags.length} anomaly flag(s)</p>` : ""}`;
}

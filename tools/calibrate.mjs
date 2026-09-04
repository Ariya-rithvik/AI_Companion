/**
 * Calibration harness. Run every surface headless and print the numbers the
 * model actually produces, so the constants in surfaces.mjs are tuned against
 * evidence rather than vibes.
 *
 *   node tools/calibrate.mjs            all surfaces, baseline + single levers
 *   node tools/calibrate.mjs webinar    one surface, plus stacked combinations
 */

import { runSession, runMonteCarlo, metricsOf } from '../engine/core.mjs';
import { SURFACE_LIST, surfaceById } from '../engine/surfaces.mjs';

const only = process.argv[2];
const list = only ? [surfaceById(only)].filter(Boolean) : SURFACE_LIST;
if (!list.length) { console.error('unknown surface: ' + only); process.exit(1); }

const p = (v, w) => String(v).padStart(w);
const l = (v, w) => String(v).padEnd(w);

for (const sf of list) {
  const base = runSession({ surface: sf, seed: 11 });
  const m = base.metrics;
  console.log('\n━━ ' + sf.label + '  (' + sf.id + ')');
  console.log('   baseline  retention ' + (m.retention * 100).toFixed(1) + '%'
    + '  dwell ' + m.avg_dwell + '  ' + sf.economics.outcomeNoun + 's ' + m.outcomes
    + '  roi ' + m.roi + '  rows ' + m.rows + '  moments ' + m.moments + '  nudges ' + base.session.nudges.length);

  const n = only ? 80 : 40;
  const scored = [];
  for (const lev of sf.levers) {
    const r = runMonteCarlo({ surface: sf, levers: [lev.id], n, seed: 3 });
    scored.push({ id: lev.id, r });
    console.log('   ' + l(lev.id, 20)
      + ' roi ' + p(r.metrics.roi.lift_pct, 7)
      + '  ci ' + p(JSON.stringify(r.metrics.roi.ci90), 18)
      + '  ret ' + p(r.metrics.retention.lift_pct, 7)
      + '  out ' + p(r.metrics.outcomes.lift_pct, 7)
      + '  ' + r.verdict);
  }

  if (only) {
    const top = scored.sort((a, b) => b.r.metrics.roi.lift_pct - a.r.metrics.roi.lift_pct).slice(0, 4).map(x => x.id);
    console.log('\n   stacked (best first): ' + top.join(' + '));
    for (let k = 1; k <= top.length; k++) {
      const r = runMonteCarlo({ surface: sf, levers: top.slice(0, k), n: 80, seed: 5 });
      console.log('   ' + k + ' skills  roi ' + p(r.metrics.roi.lift_pct, 7)
        + '  ci ' + JSON.stringify(r.metrics.roi.ci90)
        + '  ret ' + r.metrics.retention.lift_pct
        + '  out ' + r.metrics.outcomes.lift_pct);
    }
  }
}
console.log('');

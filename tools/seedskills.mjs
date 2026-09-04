/**
 * Pick each surface's seed skill library by measurement rather than taste:
 * score every lever, keep the ones whose 90% interval clears zero, and report
 * the stacked lift. The output is what ships in engine/library.mjs.
 */
import { runMonteCarlo } from '../engine/core.mjs';
import { SURFACE_LIST } from '../engine/surfaces.mjs';

const N = Number(process.argv[2]) || 100;
const pad = (v, w) => String(v).padStart(w);

for (const sf of SURFACE_LIST) {
  const scored = sf.levers
    .map(l => ({ l, r: runMonteCarlo({ surface: sf, levers: [l.id], n: N, seed: 3 }) }))
    .sort((a, b) => b.r.metrics.roi.lift_pct - a.r.metrics.roi.lift_pct);

  const keep = scored.filter(x => x.r.significant).slice(0, 3);
  const ids = keep.map(x => x.l.id);

  console.log('');
  console.log(sf.id.padEnd(12) + ' library: ' + (ids.join(' + ') || '(nothing cleared zero)'));
  for (const { l, r } of keep) {
    const m = r.metrics;
    console.log('   ' + l.id.padEnd(20) + pad(m.roi.lift_pct, 7) + '%  ci ' + pad(JSON.stringify(m.roi.ci90), 16)
      + '  ret ' + pad(m.retention.lift_pct, 6) + '  out ' + pad(m.outcomes.lift_pct, 6));
  }
  if (ids.length) {
    const st = runMonteCarlo({ surface: sf, levers: ids, n: N, seed: 5 });
    console.log('   ' + 'STACKED'.padEnd(20) + pad(st.metrics.roi.lift_pct, 7) + '%  ci '
      + pad(JSON.stringify(st.metrics.roi.ci90), 16)
      + '  ret ' + pad(st.metrics.retention.lift_pct, 6) + '  out ' + pad(st.metrics.outcomes.lift_pct, 6));
  }
}
console.log('');

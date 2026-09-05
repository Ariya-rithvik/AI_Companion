/**
 * The shipped skill library.
 *
 * Every entry here was picked by measurement, not taste: `tools/seedskills.mjs`
 * scores each lever over 100 paired runs, keeps the ones whose bootstrap 90%
 * interval clears zero, and prints exactly the numbers pasted below. Re-run it
 * after any change to surfaces.mjs, or hit "Re-test library" in the console —
 * these are claims with provenance, not constants.
 *
 * Measured 2026-09-04 (focus model v2) · n=100 per arm · seed 3.
 */

import { surfaceById } from './surfaces.mjs';

/** [leverId, roiLift, ci90, retentionLift, outcomeLift] */
const MEASURED = {
  webinar: [
    ['poll_at_8', 12.66, [10.84, 14.53], 3.11, 11.63],
    ['pricing_after_qa', 8.70, [7.23, 10.25], -10.51, 7.99],
    ['intro_trim', 5.61, [3.79, 7.70], 2.08, 5.12],
  ],
  checkout: [
    ['ship_upfront', 6.75, [5.62, 7.88], 5.37, 5.16],
    ['guest_checkout', 4.53, [3.26, 5.65], 3.25, 3.46],
    ['upi_first', 1.06, [0.68, 1.44], 0.87, 0.80],
  ],
  onboarding: [
    ['guided_setup', 26.49, [24.21, 28.82], 5.27, 19.42],
    ['invite_prompt', 2.83, [1.42, 4.18], 1.40, 2.03],
    ['sample_data', 2.28, [0.45, 4.14], 2.25, 1.57],
  ],
  support: [
    ['auto_triage', 5.96, [5.39, 6.56], 2.48, 4.58],
    ['kb_suggest', 4.94, [4.47, 5.39], 0.91, 3.79],
    ['sla_surface', 3.34, [2.89, 3.87], 1.18, 2.57],
  ],
  codereview: [
    ['auto_assign', 7.03, [6.09, 8.03], 3.49, 5.19],
    ['size_gate', 6.18, [5.23, 7.14], 2.12, 4.55],
    ['review_budget', 3.75, [3.05, 4.47], 1.19, 2.77],
  ],
  docs: [
    ['inline_sandbox', 21.53, [20.14, 22.97], 4.53, 23.65],
    ['runnable_first', 4.26, [2.95, 5.69], 2.76, 3.09],
    ['error_router', 3.35, [2.20, 4.50], 1.85, 2.44],
  ],
};

/** Stacked library lift per surface, for the ROI tab's headline before it recomputes. */
export const MEASURED_STACK = {
  webinar: { lift: 22.13, ci: [20.23, 24.06] },
  checkout: { lift: 9.22, ci: [8.14, 10.42] },
  onboarding: { lift: 30.18, ci: [27.69, 32.70] },
  support: { lift: 13.48, ci: [12.79, 14.14] },
  codereview: { lift: 13.53, ci: [12.62, 14.47] },
  docs: { lift: 24.78, ci: [23.27, 26.34] },
};

export function seedLibrary() {
  const out = [];
  for (const [sid, rows] of Object.entries(MEASURED)) {
    const sf = surfaceById(sid);
    for (const [leverId, lift, ci90, ret, outcome] of rows) {
      const l = sf.levers.find(x => x.id === leverId);
      out.push({
        id: 'skill_' + sid + ':' + leverId,
        surface: sid,
        name: l.label,
        hypothesis: l.hypo,
        trigger: `${sid}.position >= ${l.at}`,
        action: [leverId],
        transfers: l.transfers ?? [],
        evidence: {
          simulations: 100, roi_lift_pct: lift, ci90,
          retention_lift_pct: ret, outcome_lift_pct: outcome,
        },
        promoted_at: '2026-09-04T14:30:00Z',
        times_applied: 0,
        armed: true,
      });
    }
  }
  return out;
}

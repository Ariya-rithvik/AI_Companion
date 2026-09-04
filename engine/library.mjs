/**
 * The shipped skill library.
 *
 * Every entry here was picked by measurement, not taste: `tools/seedskills.mjs`
 * scores each lever over 100 paired runs, keeps the ones whose bootstrap 90%
 * interval clears zero, and prints exactly the numbers pasted below. Re-run it
 * after any change to surfaces.mjs, or hit "Re-test library" in the console —
 * these are claims with provenance, not constants.
 *
 * Measured 2026-09-04 · n=100 per arm · seed 3.
 */

import { surfaceById } from './surfaces.mjs';

/** [leverId, roiLift, ci90, retentionLift, outcomeLift] */
const MEASURED = {
  webinar: [
    ['poll_at_8', 21.27, [19.21, 23.32], 4.54, 18.98],
    ['pricing_after_qa', 15.88, [14.08, 17.74], -12.30, 14.17],
    ['exit_intent', 10.11, [7.23, 13.24], 8.08, 13.11],
  ],
  checkout: [
    ['exit_offer', 14.39, [12.52, 16.24], 5.27, 16.81],
    ['ship_upfront', 5.49, [4.31, 6.64], 5.88, 4.00],
    ['guest_checkout', 4.34, [3.09, 5.65], 3.69, 3.16],
  ],
  onboarding: [
    ['guided_setup', 26.48, [23.78, 29.21], 5.95, 19.52],
    ['invite_prompt', 2.50, [0.58, 4.42], 1.25, 1.73],
    ['sample_data', 2.18, [0.39, 3.93], 3.02, 1.49],
  ],
  support: [
    ['auto_triage', 6.80, [6.13, 7.44], 2.69, 5.21],
    ['kb_suggest', 5.19, [4.69, 5.73], 1.00, 3.97],
    ['sla_surface', 4.38, [3.76, 5.01], 1.42, 3.35],
  ],
  codereview: [
    ['auto_assign', 7.28, [6.27, 8.25], 3.35, 5.36],
    ['size_gate', 6.89, [6.00, 7.80], 2.71, 5.09],
    ['review_budget', 4.46, [3.68, 5.24], 1.69, 3.28],
  ],
  docs: [
    ['inline_sandbox', 26.56, [24.91, 28.31], 5.93, 26.95],
    ['runnable_first', 4.82, [3.20, 6.31], 3.72, 3.38],
    ['error_router', 1.78, [0.51, 3.22], 1.38, 1.20],
  ],
};

/** Stacked library lift per surface, for the ROI tab's headline before it recomputes. */
export const MEASURED_STACK = {
  webinar: { lift: 42.12, ci: [38.85, 45.66] },
  checkout: { lift: 25.71, ci: [23.48, 28.01] },
  onboarding: { lift: 32.92, ci: [30.41, 35.37] },
  support: { lift: 13.80, ci: [13.13, 14.41] },
  codereview: { lift: 14.24, ci: [13.16, 15.36] },
  docs: { lift: 34.70, ci: [32.68, 36.69] },
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
        promoted_at: '2026-09-04T09:00:00Z',
        times_applied: 0,
        armed: true,
      });
    }
  }
  return out;
}

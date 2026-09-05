/**
 * The real effect estimate. Replaces the prototype's Monte Carlo entirely.
 *
 * The prototype simulated both arms. Here both arms are real meetings that
 * actually happened, so the statistics are ordinary and the honesty burden moves
 * to refusing to report early.
 *
 * BUILD:
 *  - export analyze(experimentId):
 *      1. load assignments and their sessions
 *      2. if n < n_required: return { effect: null, n, n_required,
 *         reason: 'underpowered' }. RETURN, do not compute. Peeking early and
 *         stopping when it looks good inflates false positives badly
 *      3. compute the primary metric per meeting (one number per meeting, not per
 *         participant - participants inside a meeting are correlated, and treating
 *         them as independent will make your CI about four times too narrow)
 *      4. difference in means between arms
 *      5. bootstrap 90% CI on that difference - port bootstrapCI from
 *         ../../engine/core.mjs, it is the one piece of the prototype that was
 *         real statistics
 *      6. return { effect, ci90, n_per_arm, metric, compliance_rate }
 *  - export observational({ sinceDays }) for the pre-experiment phase:
 *      correlations only, and every returned object must carry
 *      caveat: 'observational - not causal'. The console must print that caveat
 *      next to the number, not in a footnote
 *  - never report a p-value alongside an interval you already reported; pick one
 *    and stick to it. The interval is more useful here
 */

/**
 * Pre-registration. Write the hypothesis down BEFORE the meetings run.
 *
 * This file is the difference between a measurement and a story. Without it you
 * will run twenty meetings, look at the data, notice something, and report it as
 * a finding - and it will be noise about half the time.
 *
 * BUILD:
 *  - export register({ id, hypothesis, change, primary_metric, mde, arms,
 *                      n_required, owner })
 *      * n_required comes from power.mjs; refuse to register without it
 *      * write to ObsExperiment with status 'registered' and a frozen created_at
 *      * once status is 'running', reject edits to primary_metric or mde. That
 *        immutability IS the feature
 *  - export list(), get(id), close(id, { conclusion })
 *  - secondary metrics are allowed but must be declared up front and reported as
 *    exploratory, never as the headline
 */

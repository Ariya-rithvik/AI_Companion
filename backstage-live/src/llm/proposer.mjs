/**
 * Reads MANY real sessions and proposes changes worth testing. Weekly, not per
 * meeting. This is where the "it learns" claim becomes real — the proposals come
 * out of your data, not out of a hardcoded lever list like the prototype had.
 *
 * BUILD:
 *  - export proposeChanges({ sinceDays = 30, minSessions = 8 })
 *  - REFUSE to run under minSessions and say how many you have. Proposals from
 *    three meetings are astrology.
 *  - input: aggregate stats across sessions (retention curves overlaid, leave-time
 *    histograms, unanswered-question counts, hidden_ratio by segment), plus the
 *    validated findings from each session's report
 *  - output PROPOSAL_SCHEMA. Each proposal must name:
 *      primary_metric              e.g. "retention at 30 min"
 *      minimum_detectable_effect   e.g. "5 percentage points"
 *      supporting_sessions         the session ids that motivated it
 *  - feed each proposal straight into experiments/power.mjs to get its required N
 *    before anyone commits to running it
 *  - a proposal is a HYPOTHESIS, not a skill. It becomes a skill only after
 *    assign.mjs randomises it and analyze.mjs measures it. Enforce that ordering
 *    in code — promote.mjs should refuse anything without an experiment_id.
 */

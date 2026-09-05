/**
 * Post-meeting analysis over the REAL event log. Runs once, after ended_at.
 *
 * BUILD:
 *  - export analyzeSession(sessionId) -> report object matching REPORT_SCHEMA
 *  - assemble input in this order (it matters):
 *      1. session facts computed in JS, not by the model: duration, peak,
 *         retention curve sampled per minute, per-participant tenure and counters,
 *         leave timestamps grouped into clusters
 *      2. the transcript segments, if consent allowed them
 *      3. the moments the live observer already flagged
 *    Give the model the arithmetic already done. Its job is interpretation.
 *  - call with MODEL_ANALYST and REPORT_SCHEMA
 *  - VALIDATE cited_seqs against the DB and drop uncited findings, same as the
 *    observer. This validator is the single most important function in the repo:
 *    it is what separates an analyst from a generator of plausible sentences.
 *  - store the report on ObsSession.report and render it in the console
 *  - the report must be able to say "nothing notable happened". Add that to the
 *    prompt explicitly, or you will get invented drama in every quiet meeting.
 */

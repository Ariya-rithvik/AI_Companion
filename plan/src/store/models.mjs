/**
 * Mongoose models. Prefixed "Obs" so they never collide with your canvas models.
 *
 * ObservationEvent   the row from normalize.mjs
 *   indexes: { session_id: 1, seq: 1 } unique
 *            { session_id: 1, type: 1 }
 *            { actor: 1, t: 1 }
 *   NOTE: this is the high-volume collection. A 45-minute 20-person meeting is
 *   roughly 3-8k rows after stroke debouncing. Plan a TTL or an archive job before
 *   you have a hundred meetings, not after.
 *
 * ObsSession
 *   { session_id, meeting_id, title, host_id, started_at, ended_at, peak,
 *     participants: [{ actor, joined_at, left_at, consent, role }],
 *     stages: [{ id, label, from_s, to_s }],       <- host-declared agenda, optional
 *     arm: String,                                  <- experiment arm, see assign.mjs
 *     costs: { llm_usd, stt_usd },
 *     labels_backfilled: Boolean }
 *
 * ObsMoment          what the LLM flagged
 *   { session_id, t, kind, caption, cited_seqs: [Number], model, confidence }
 *   cited_seqs is what makes a moment checkable. A moment with an empty
 *   cited_seqs array must be rejected on write.
 *
 * ObsSkill           a change that survived a real experiment
 *   { id, name, hypothesis, trigger, action, evidence: { experiment_id, n_meetings,
 *     effect, ci90, metric }, promoted_at, armed }
 *   REFUSE to save a skill whose evidence.n_meetings is below the pre-registered N.
 *   Enforce it in a pre-save hook, not in a comment.
 *
 * ObsAssignment      the randomisation ledger, see experiments/assign.mjs
 *   { experiment_id, meeting_id, arm, assigned_at, decided_before_meeting: Boolean }
 *
 * BUILD: export the five models. Add the indexes explicitly; do not rely on
 * autoIndex in production.
 */

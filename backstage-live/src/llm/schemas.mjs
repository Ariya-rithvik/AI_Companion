/**
 * JSON schemas for structured LLM output. Used as tool definitions by
 * client.askStructured. Keeping them here means the prompt and the shape cannot
 * drift apart silently.
 *
 * BUILD — export these three:
 *
 * MOMENT_SCHEMA
 *   { moments: [ { kind, caption, cited_seqs: [int], confidence: 0..1,
 *                  urgency: "low"|"medium"|"high" } ],
 *     nudge: { text, urgency, cited_seqs } | null }
 *   Rules encoded in the schema: cited_seqs minItems 1; caption maxLength 140;
 *   nudge.text maxLength 220 — a nudge a host cannot read in three seconds
 *   during a live meeting is not a nudge.
 *
 * REPORT_SCHEMA
 *   { headline, findings: [ { claim, cited_seqs: [int], severity, metric_delta } ],
 *     drop_points: [ { t_range, count, likely_cause, cited_seqs } ],
 *     questions_unanswered: [ { text, asker, cited_seqs } ],
 *     recommended_changes: [ { change, rationale, expected_direction,
 *                              measurable_as } ] }
 *   expected_direction is "up"|"down" — NOT a percentage. The model must not
 *   predict effect sizes; that is what the experiment is for.
 *
 * PROPOSAL_SCHEMA
 *   { proposals: [ { id, name, hypothesis, applies_when, change_description,
 *                    primary_metric, minimum_detectable_effect,
 *                    supporting_sessions: [id] } ] }
 */

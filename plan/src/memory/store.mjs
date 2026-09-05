/**
 * Durable memory across REAL sessions. Mongo-backed sibling of the prototype's
 * engine/memory.mjs — read that file first, the loop is identical and already
 * proven; only the storage and the evidence change.
 *
 * COLLECTIONS (add to store/models.mjs):
 *   ObsEpisode   one finished real meeting, compressed
 *     { session_id, surface, host_id, at, duration_s, peak,
 *       losses: [{ stage, label, count, top_reason, median_position }],
 *       unanswered: [{ text, asker, seq }],
 *       metrics: { retention, outcomes, avg_dwell },
 *       arm, compliance }                       <- if it was in an experiment
 *
 *   ObsPattern   a claim that RECURS across episodes
 *     { id, surface, host_id, kind, statement, detail,
 *       where: { stage, label, position },
 *       evidence: { episodes: [session_id], n, of, share, cited_seqs: [] },
 *       confidence, confirmed, contradicted, first_seen, last_seen,
 *       observational: Boolean, muted: Boolean, source: 'rule' | 'llm' }
 *
 *   ObsPersonMemory   what you know about a specific returning attendee
 *     { person_key, surface, attended: [session_id], asked: [], objections: [],
 *       last_seen, notes: [{ text, cited_seqs, at }] }
 *     GATE THIS ON CONSENT. Per-person memory across meetings is the most
 *     sensitive thing here; it must be opt-in, visible to the person it is
 *     about, and deletable by them on request. Build the delete path first.
 *
 * BUILD:
 *  - export saveEpisode(sessionId)      compress a closed session -> ObsEpisode
 *  - export episodes({ surface, hostId, limit })
 *  - export upsertPattern(p) / mute(id) / all({ surface })
 *  - export MIN_EPISODES = 3            same gate as the prototype
 *  - confidence = share * (1 - e^(-n/3)) * 0.5^(contradicted/12)
 *    Port it verbatim from engine/memory.mjs; it is already tuned and the two
 *    implementations disagreeing later would be worse than either being wrong.
 */

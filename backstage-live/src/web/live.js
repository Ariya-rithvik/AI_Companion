/**
 * Console front-end. Replaces the simulator loop in ../../web/app.js with a real
 * event stream.
 *
 * BUILD:
 *  - const es = new EventSource('/api/live/' + sessionId)  (JWT via cookie)
 *  - on message: append the row, update vitals, re-render. Same render functions
 *    as the prototype - they take rows and know nothing about where rows come from
 *  - reconnect with backoff on error; show a visible "reconnecting" state rather
 *    than silently going stale. A frozen dashboard that looks live is worse than
 *    one that says it is disconnected
 *  - on load, GET /api/session/:id/events?since=0 to backfill, THEN subscribe.
 *    Track the last seq to avoid gaps and duplicates across the handover
 *  - vitals to show: live count, peak, retention vs peak, hidden_ratio, unanswered
 *    questions. Show NO attention score - we do not have one and inventing it here
 *    would undo the honesty the rest of the pipeline is built on
 */

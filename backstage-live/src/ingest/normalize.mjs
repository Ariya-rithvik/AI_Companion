/**
 * The single row schema. Every source — socket tap, browser beacon, transcript,
 * Zoom adapter — funnels through here, so the console, the exporter and the MCP
 * server only ever learn one shape.
 *
 * ROW:
 *   seq          monotonic per session, assigned here (not by the caller)
 *   t            seconds since session start (number)
 *   ts           "MM:SS" for display
 *   session_id   the meeting id from your Meeting model
 *   surface      "meeting" for now; the field exists so other surfaces can join later
 *   type         see EVENT TYPES below
 *   actor        participant id, or "host" / "companion" / "system"
 *   stage        agenda segment if the host set one, else "unsegmented"
 *   payload      raw source-specific detail
 *   features     numeric/categorical values usable as ML features
 *   label        { churn_next: null, outcome: null }  <- back-filled after the meeting
 *
 * EVENT TYPES (keep this list closed; add deliberately):
 *   participant.join     participant.leave      participant.rejoin
 *   chat.message         canvas.stroke          screenshare.start / .stop
 *   mic.toggle           camera.toggle          reaction
 *   tab.hidden           tab.visible            idle.start / idle.end
 *   speech.segment       stage.change
 *   companion.moment     companion.nudge        companion.error
 *
 * BUILD:
 *  - export makeRow({ sessionId, startedAt, type, actor, payload, features, stage })
 *    -> computes t and ts from startedAt and Date.now(), fills label with nulls
 *  - export const EVENT_TYPES = [...]  and validate type against it; throw on unknown
 *  - export featuresFor(type, payload, sessionState) -> the derived numbers:
 *      tenure_s          seconds this actor has been in the meeting
 *      concurrent        participants live right now
 *      cohort_retention  concurrent / peak
 *      since_interaction_s   seconds since this actor last did anything
 *      hidden_ratio      fraction of their time so far with the tab hidden
 *      msgs, strokes, reactions, speaking_s   running counters
 *  - DO NOT compute an "attention score" here. Attention is not observable.
 *    Emit the observable proxies above and let the analyst reason over them.
 *    Naming a guess "attention: 0.42" is how a real system starts lying.
 */

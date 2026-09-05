/**
 * Attaches to YOUR Socket.io server and turns meeting events into rows.
 * This is the main source of truth. See patches/socketHandler.patch.md for the
 * three lines you add to Backend/socket/socketHandler.js .
 *
 * Two deployment shapes — pick one and delete the other:
 *   A) IN-PROCESS  — import this from your canvas Backend and call attach(io).
 *      Fastest, no network hop, but couples the two repos.
 *   B) HTTP RELAY  — your socketHandler POSTs each event to this service at
 *      /ingest with the BACKSTAGE_INGEST_SECRET header. Keeps the repos separate.
 *      Recommended: your meeting server must never block on our LLM calls.
 *
 * BUILD (shape B, recommended):
 *  - export attach(io) for shape A, and handleIngest(body) for shape B; both end
 *    up calling the same record(evt)
 *  - record(evt):
 *      1. look up or create the session (store/models.mjs -> ObsSession)
 *      2. maintain in-memory session state: Map<sessionId, {startedAt, peak,
 *         actors: Map<actorId, {joinedAt, lastInteraction, msgs, strokes, hiddenMs}>}>
 *      3. row = normalize.makeRow(...)
 *      4. bulk-insert with a 1s / 50-row buffer — do NOT await a write per event,
 *         a busy 40-person meeting emits hundreds of canvas.stroke events a second
 *      5. push the row to the SSE hub (server/routes.mjs) for the live console
 *      6. hand the row to llm/observer.mjs's rolling window (it decides when to call)
 *  - DEBOUNCE canvas.stroke: aggregate into one row per actor per 5s with a
 *    stroke_count, or the dataset becomes 95% noise and the LLM context fills with it
 *  - on 'disconnect', emit participant.leave with reason 'socket_disconnect';
 *    on an explicit leave button, reason 'left_meeting'. The distinction matters —
 *    a dropped connection is not a person choosing to leave
 *  - handle rejoin: same actor id joining again is participant.rejoin, and tenure_s
 *    must accumulate across sessions rather than reset
 */

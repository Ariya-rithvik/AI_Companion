/**
 * The live companion. Runs DURING a real meeting and is the thing that makes
 * "the AI is actually there" true rather than a claim.
 *
 * LOOP:
 *  - maintain a rolling window per session: the last 3 minutes of rows, plus a
 *    compact running summary of the meeting so far (regenerate the summary every
 *    10 minutes, not every tick, or you pay for it constantly)
 *  - every 30-60s, OR immediately when a trigger fires, call the model
 *  - triggers that skip the timer:
 *      3+ leaves inside 90 seconds
 *      a question in chat unanswered for > 2 minutes
 *      one speaker holding the floor > 6 minutes with no other signal
 *      hidden_ratio across live participants crossing 0.4
 *    These are cheap arithmetic. Compute them in JS and let the LLM explain and
 *    prioritise — do not ask the model to do arithmetic over raw rows.
 *
 * BUILD:
 *  - export startObserver(sessionId) / stopObserver(sessionId)
 *  - export ingest(row) — called by socket-tap for every row; updates the window
 *  - buildWindowText(rows) -> compact lines like
 *      "[12:30] participant.leave actor-7 tenure=740s msgs=0 hidden_ratio=0.62"
 *    Send counts and ids, not prose. The model reasons better over a table.
 *  - call client.askStructured with MOMENT_SCHEMA and prompts/observer.md
 *  - VALIDATE before storing: every cited_seq must exist in this session's rows.
 *    Drop any moment that fails. Log the drop rate — if it climbs above ~5% your
 *    prompt or window format is wrong and you need to know that.
 *  - write surviving moments to ObsMoment and push the nudge to the host's SSE
 *    channel only
 *  - hard rate limit: at most one nudge every 3 minutes per session, regardless
 *    of how many the model produces. A companion that interrupts constantly gets
 *    turned off in the first real meeting.
 *  - budget guard: stop calling if ObsSession.costs.llm_usd exceeds a per-meeting
 *    ceiling from config, and write a companion.error row saying so.
 */

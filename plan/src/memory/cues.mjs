/**
 * Patterns become useful only when they arrive early enough to act on.
 *
 * BUILD:
 *  - export cuesFor({ surface, hostId, horizon, stages })
 *      * positional pattern -> fire at (position - 8% of horizon)
 *      * question pattern   -> fire just before the first interactive stage,
 *        staggered, at most 2 (three cues in one second is noise, not help)
 *      * only patterns with confidence >= 0.3 and muted === false
 *  - export briefFor({ surface, hostId })   the pre-meeting page the host reads
 *      * below MIN_EPISODES return { ready:false, message:'Watching. 1 of 3...' }
 *      * include the retention trend of recent meetings vs older ones
 *  - export markFired(sessionId, cueId)     never fire the same cue twice
 *  - export outcome(cueId, { acted, worked }) — did the host act, and did it
 *    help? This is the only signal that tells you a cue is worth firing. Feed
 *    it back into confidence.
 *
 * DELIVERY:
 *  Cues go over the host-only SSE channel from server/routes.mjs, tagged so the
 *  console can render them apart from live-detected nudges. In the prototype
 *  they were buried under routine nudges until they were pinned — pin them here
 *  from the start.
 *
 * RATE LIMIT: at most one cue every 3 minutes, regardless of how many are due.
 * A companion that interrupts constantly gets turned off in the first real meeting.
 */

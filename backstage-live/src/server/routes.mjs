/**
 * Route handlers and the SSE hub.
 *
 * AUTH — get this right, everything else depends on it:
 *  - /ingest requires the X-Backstage-Secret header to equal config.ingestSecret
 *  - /api/* requires the SAME JWT your canvas Backend issues; verify with
 *    config.jwtSecret and check that the caller is the HOST of that meeting.
 *    A participant hitting their own meeting's console must get 403. This is the
 *    "only the owner can see it" requirement, and it is enforced here or nowhere.
 *
 * SSE HUB:
 *  - Map<sessionId, Set<res>>
 *  - export publish(sessionId, row) called by socket-tap for every row
 *  - heartbeat comment every 15s or proxies will close the connection
 *  - clean up on 'close'; a leaked Set of dead responses will eat memory over a
 *    week of meetings
 *  - send only what the console needs. Do not stream raw canvas.stroke rows to the
 *    browser; send the debounced aggregate
 */

/**
 * Browser-side beacon. Drop into Frontend/components/Meeting/ and mount from
 * Meeting.jsx. See patches/Meeting.jsx.patch.md .
 *
 * This is the ONLY honest source of attention-adjacent signal, because it is the
 * only thing that can see whether the meeting tab is actually in front of the person.
 *
 * BUILD:
 *  - export function startBeacon({ socket, meetingId, userId })
 *  - listen for:
 *      document.visibilitychange  -> emit tab.hidden / tab.visible
 *      window blur / focus        -> emit window.blur / window.focus
 *      no mouse/key/canvas event for 60s -> idle.start ; next input -> idle.end
 *  - emit through the EXISTING socket connection ('backstage:signal', payload).
 *    Do not open a second socket; you will double your connection count for nothing.
 *  - throttle: at most one event per type per 5 seconds per client
 *  - return a cleanup() that removes every listener — React StrictMode mounts
 *    twice in dev and you will get duplicate rows if you skip this
 *
 * PRIVACY — non-negotiable:
 *  - never capture keystrokes, clipboard, or the content of other tabs
 *  - never take screenshots of the participant's screen
 *  - the beacon reports "this tab was hidden for 4 minutes", nothing about where
 *    they went. Write that sentence in the consent banner, because it is the truth
 *    and it is what makes this defensible.
 */

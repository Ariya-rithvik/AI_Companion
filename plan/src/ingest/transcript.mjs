/**
 * Real speech -> speech.segment rows. Phase 3.
 *
 * TWO PATHS — implement the batch one first, it is far simpler and is enough for
 * the analyst. Only build live STT if you actually need mid-meeting nudges that
 * depend on what was said.
 *
 * A) BATCH (build this first)
 *    Your meetingController already uploads the WebRTC recording to Cloudinary.
 *    - subscribe to that upload completing (or poll the Meeting doc for recordingUrl)
 *    - send the URL to Deepgram (or Whisper) with diarization enabled
 *    - map each returned segment to a speech.segment row:
 *        payload: { text, speaker, confidence, start_s, end_s }
 *        features: { words, duration_s, wpm, speaker_switch: 0|1 }
 *    - speaker labels come back as "0","1","2" — map them to real participant ids
 *      using join/leave times plus your active-speaker socket events. Store the
 *      mapping confidence; if it is low, leave actor as "speaker_1" rather than
 *      guessing a name. A wrongly attributed quote is worse than an anonymous one.
 *
 * B) LIVE (only if needed)
 *    - open a Deepgram streaming socket per meeting, feed the mixed audio track
 *    - emit speech.segment rows as interim results finalise
 *    - cost scales with meeting-minutes; measure it before enabling by default
 *
 * BUILD:
 *  - export transcribeSession(sessionId) -> { segments, provider, cost_usd }
 *  - export attachLive(sessionId, audioStream) for path B
 *  - store cost per meeting in ObsSession.costs so you can see what this is spending
 *  - GATE ON CONSENT: refuse to transcribe unless every participant in the session
 *    has consent=true in the DB. Throw a named error; do not silently skip.
 */

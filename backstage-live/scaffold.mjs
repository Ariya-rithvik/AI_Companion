/* Run once with `node scaffold.mjs`, then delete this file. */
import fs from 'node:fs';
import path from 'node:path';

const F = {};

/* ─────────────────────────────── root ─────────────────────────────── */

F['.env.example'] = `
# ── Backstage Live ──────────────────────────────────────────────────────
# Copy to .env . Never commit .env .

# Same MongoDB your canvas app already uses. Backstage writes its own
# collections (observationevents, obssessions, obsmoments, obsskills,
# obsassignments) so it cannot corrupt your meeting data.
MONGODB_URI=mongodb://localhost:27017/collab_canvas

# Anthropic. Get a key at console.anthropic.com .
ANTHROPIC_API_KEY=
MODEL_OBSERVER=claude-haiku-4-5-20251001
MODEL_ANALYST=claude-sonnet-5
MODEL_PROPOSER=claude-opus-5

# Optional fallback you already have wired in the canvas repo.
GROQ_API_KEY=

# Speech-to-text for Phase 3. Pick ONE and implement only that path.
#   deepgram | openai-whisper | local-whisper
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=
OPENAI_API_KEY=

# Shared secret between your canvas Backend and this service, so socket-tap
# posts cannot be forged by anyone who finds the URL.
BACKSTAGE_INGEST_SECRET=change-me

# Must match the JWT secret in your canvas Backend, so we can verify that the
# person opening the console really is the meeting host.
JWT_SECRET=

PORT=8790
`;

F['package.json'] = `
{
  "name": "backstage-live",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Real observation layer for the Real-Time-Collaborative-Digital-Canvas meeting platform. No simulation.",
  "scripts": {
    "dev": "node --watch src/server/app.mjs",
    "start": "node src/server/app.mjs",
    "mcp": "node src/server/mcp.mjs",
    "export": "node scripts/export-dataset.mjs",
    "backfill": "node scripts/backfill-labels.mjs",
    "power": "node src/experiments/power.mjs"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.65.0",
    "mongoose": "^8.9.0",
    "express": "^4.21.0",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.4.5"
  },
  "engines": { "node": ">=20" }
}
`;

F['README.md'] = `
# Backstage Live

Real observation layer for your meeting platform. Read **PLAN.md** first — it is the spec.

~~~bash
cp .env.example .env      # fill in MONGODB_URI and ANTHROPIC_API_KEY
npm install
npm run dev               # console + ingest on :8790
~~~

Then apply the two patches in \`patches/\` to your canvas repo. Nothing is observed until
you do — this service has no way to see a meeting on its own, by design.

**Order of work is in PLAN.md section 3. Do not skip Phase 1's acceptance test.**
`;

/* ─────────────────────────────── config ─────────────────────────────── */

F['src/config.mjs'] = `
/**
 * Central config. Every other file imports from here — no process.env reads
 * scattered through the codebase.
 *
 * BUILD:
 *  - load dotenv
 *  - export a frozen object: mongoUri, anthropicKey, models{observer,analyst,proposer},
 *    stt{provider,key}, ingestSecret, jwtSecret, port
 *  - throw at import time if MONGODB_URI or ANTHROPIC_API_KEY is missing, with a
 *    message naming the variable. Failing loudly at boot beats failing at 2am
 *    inside a live meeting.
 *  - export IS_DEV = process.env.NODE_ENV !== 'production'
 */
`;

/* ─────────────────────────────── ingest ─────────────────────────────── */

F['src/ingest/normalize.mjs'] = `
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
`;

F['src/ingest/socket-tap.mjs'] = `
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
`;

F['src/ingest/client-beacon.js'] = `
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
`;

F['src/ingest/transcript.mjs'] = `
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
`;

F['src/ingest/zoom-adapter.mjs'] = `
/**
 * OPTIONAL. Only build this if you need to observe meetings on real Zoom rather
 * than your own platform. Your own platform is strictly better for this project —
 * you get canvas strokes, per-participant permissions and tab visibility, none of
 * which Zoom will ever give you. Treat this as a "works with Zoom too" checkbox.
 *
 * BUILD:
 *  - Zoom Webhooks give you: meeting.started/ended, participant_joined/left,
 *    recording.completed. Verify the x-zm-signature header — unverified webhook
 *    endpoints are a standing invitation to forged events.
 *  - map each to the same row types as socket-tap so nothing downstream changes
 *  - Zoom gives you NO attention signal and NO chat unless you run a meeting bot
 *    via the RTMS / Meeting SDK. Note that limitation in the console rather than
 *    quietly showing thinner data that looks the same.
 */
`;

/* ─────────────────────────────── store ─────────────────────────────── */

F['src/store/mongo.mjs'] = `
/**
 * Mongoose connection. Reuses the same MongoDB as your canvas app.
 *
 * BUILD:
 *  - export connect() -> mongoose.connect(config.mongoUri) with:
 *      maxPoolSize 10, serverSelectionTimeoutMS 5000
 *  - log once on 'connected' and on 'error'; do not swallow errors
 *  - export disconnect() for tests
 *  - guard against double-connect (Node --watch re-imports on every save)
 */
`;

F['src/store/models.mjs'] = `
/**
 * Mongoose models. Prefixed "Obs" so they never collide with your canvas models.
 *
 * ObservationEvent   the row from normalize.mjs
 *   indexes: { session_id: 1, seq: 1 } unique
 *            { session_id: 1, type: 1 }
 *            { actor: 1, t: 1 }
 *   NOTE: this is the high-volume collection. A 45-minute 20-person meeting is
 *   roughly 3-8k rows after stroke debouncing. Plan a TTL or an archive job before
 *   you have a hundred meetings, not after.
 *
 * ObsSession
 *   { session_id, meeting_id, title, host_id, started_at, ended_at, peak,
 *     participants: [{ actor, joined_at, left_at, consent, role }],
 *     stages: [{ id, label, from_s, to_s }],       <- host-declared agenda, optional
 *     arm: String,                                  <- experiment arm, see assign.mjs
 *     costs: { llm_usd, stt_usd },
 *     labels_backfilled: Boolean }
 *
 * ObsMoment          what the LLM flagged
 *   { session_id, t, kind, caption, cited_seqs: [Number], model, confidence }
 *   cited_seqs is what makes a moment checkable. A moment with an empty
 *   cited_seqs array must be rejected on write.
 *
 * ObsSkill           a change that survived a real experiment
 *   { id, name, hypothesis, trigger, action, evidence: { experiment_id, n_meetings,
 *     effect, ci90, metric }, promoted_at, armed }
 *   REFUSE to save a skill whose evidence.n_meetings is below the pre-registered N.
 *   Enforce it in a pre-save hook, not in a comment.
 *
 * ObsAssignment      the randomisation ledger, see experiments/assign.mjs
 *   { experiment_id, meeting_id, arm, assigned_at, decided_before_meeting: Boolean }
 *
 * BUILD: export the five models. Add the indexes explicitly; do not rely on
 * autoIndex in production.
 */
`;

F['src/store/dataset.mjs'] = `
/**
 * Turns stored events into a training file, and back-fills the labels that make
 * it trainable. This is the artefact the whole project exists to produce.
 *
 * LABELS (computed only after ended_at is set — never during the meeting):
 *   label.churn_next   1 if this actor left within the next 5 minutes of this row's t
 *   label.outcome      1 if the actor met the session's success definition
 *
 * The outcome definition is NOT ours to invent. It must come from something real:
 *   - they stayed to the end AND sent >= 1 chat message, or
 *   - they clicked the CTA link (needs a tracked link), or
 *   - your CRM says a deal was created within 14 days (best, needs a CRM join key)
 * Store which definition was used in ObsSession.outcome_definition, so a dataset
 * exported in March is still interpretable in September.
 *
 * BUILD:
 *  - export backfillLabels(sessionId) -> updates rows in bulk; idempotent;
 *    sets ObsSession.labels_backfilled = true
 *  - export exportJSONL({ sessionIds, out }) -> one row per line
 *  - export exportCSV({ sessionIds, out }) -> flattened features + labels
 *  - export stats() -> { sessions, rows, labelled, positives, class_balance }
 *    Print class balance. Churn positives will be a small minority and anyone
 *    training on this needs to know that before they celebrate 94% accuracy.
 */
`;

/* ─────────────────────────────── llm ─────────────────────────────── */

F['src/llm/client.mjs'] = `
/**
 * The Anthropic client. Every LLM call in this project goes through here so that
 * retries, caching, cost accounting and logging exist in exactly one place.
 *
 * BUILD:
 *  - import Anthropic from '@anthropic-ai/sdk'
 *  - export async function ask({ model, system, messages, tools, maxTokens, sessionId })
 *      * pass system as an array block with { cache_control: { type: 'ephemeral' } }
 *        so the observer's repeated preamble is cached — this is the single biggest
 *        cost lever in the project
 *      * retry on 429 and 5xx with exponential backoff + jitter, max 3 attempts
 *      * on final failure, write a companion.error row and return null. The meeting
 *        must not break because the API had a bad minute
 *      * record usage.input_tokens / output_tokens / cache_read_input_tokens into
 *        ObsSession.costs.llm_usd using current per-model prices
 *  - export askStructured({ ...same, schema }) -> forces a tool call with the given
 *    JSON schema and returns the parsed object. Do not parse JSON out of prose;
 *    use tool calling, it is what makes the output reliably machine-readable.
 *  - export a MODELS map from config so callers never hardcode a model id
 *
 * DO NOT put prompt text in this file. Prompts live in prompts/*.md .
 */
`;

F['src/llm/schemas.mjs'] = `
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
`;

F['src/llm/observer.mjs'] = `
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
`;

F['src/llm/analyst.mjs'] = `
/**
 * Post-meeting analysis over the REAL event log. Runs once, after ended_at.
 *
 * BUILD:
 *  - export analyzeSession(sessionId) -> report object matching REPORT_SCHEMA
 *  - assemble input in this order (it matters):
 *      1. session facts computed in JS, not by the model: duration, peak,
 *         retention curve sampled per minute, per-participant tenure and counters,
 *         leave timestamps grouped into clusters
 *      2. the transcript segments, if consent allowed them
 *      3. the moments the live observer already flagged
 *    Give the model the arithmetic already done. Its job is interpretation.
 *  - call with MODEL_ANALYST and REPORT_SCHEMA
 *  - VALIDATE cited_seqs against the DB and drop uncited findings, same as the
 *    observer. This validator is the single most important function in the repo:
 *    it is what separates an analyst from a generator of plausible sentences.
 *  - store the report on ObsSession.report and render it in the console
 *  - the report must be able to say "nothing notable happened". Add that to the
 *    prompt explicitly, or you will get invented drama in every quiet meeting.
 */
`;

F['src/llm/proposer.mjs'] = `
/**
 * Reads MANY real sessions and proposes changes worth testing. Weekly, not per
 * meeting. This is where the "it learns" claim becomes real — the proposals come
 * out of your data, not out of a hardcoded lever list like the prototype had.
 *
 * BUILD:
 *  - export proposeChanges({ sinceDays = 30, minSessions = 8 })
 *  - REFUSE to run under minSessions and say how many you have. Proposals from
 *    three meetings are astrology.
 *  - input: aggregate stats across sessions (retention curves overlaid, leave-time
 *    histograms, unanswered-question counts, hidden_ratio by segment), plus the
 *    validated findings from each session's report
 *  - output PROPOSAL_SCHEMA. Each proposal must name:
 *      primary_metric              e.g. "retention at 30 min"
 *      minimum_detectable_effect   e.g. "5 percentage points"
 *      supporting_sessions         the session ids that motivated it
 *  - feed each proposal straight into experiments/power.mjs to get its required N
 *    before anyone commits to running it
 *  - a proposal is a HYPOTHESIS, not a skill. It becomes a skill only after
 *    assign.mjs randomises it and analyze.mjs measures it. Enforce that ordering
 *    in code — promote.mjs should refuse anything without an experiment_id.
 */
`;

F['src/llm/prompts/observer.md'] = `
<!--
Live observer prompt. Loaded by llm/observer.mjs .

WRITE IT TO SAY, roughly:

  You are watching a live meeting on behalf of the host, who is the only person
  who can see you. You receive the last three minutes of observed events and a
  summary of the meeting so far.

  Report only what the events support. Every moment and nudge must cite the seq
  numbers of the events it rests on. If nothing in this window is worth the
  host's attention, return an empty moments array and a null nudge - that is a
  correct and expected answer, not a failure.

  You cannot see faces, screens or anything not in the events. You do not know
  whether someone is engaged; you know whether their tab was hidden and whether
  they typed. Say the observable thing.

  A nudge must be an action the host can take in the next thirty seconds while
  still presenting. "Ask Priya's pricing question from 12:04, still unanswered"
  is a nudge. "Improve engagement" is not.

RULES TO STATE EXPLICITLY:
  - never name a participant unless their id appears in the cited events
  - never estimate a percentage that is not in the input
  - at most one nudge per call
  - urgency high is reserved for something happening right now that is still
    recoverable
-->
`;

F['src/llm/prompts/analyst.md'] = `
<!--
Post-meeting analyst prompt. Loaded by llm/analyst.mjs .

WRITE IT TO SAY, roughly:

  You are writing the post-meeting report for the host. You receive computed
  session statistics, the event log, the transcript if one exists, and the
  moments flagged live.

  Every finding cites seq numbers. A finding you cannot cite does not go in the
  report. If the meeting was unremarkable, say so in the headline and return few
  findings - a short honest report is the goal, not a long one.

  Distinguish clearly between what happened (nine people left between 22:00 and
  24:30) and what might explain it (the pricing section started at 21:40). Never
  present the second as the first.

  For recommended_changes, give the direction you expect and how it would be
  measured. Do not predict a percentage; the team will measure it with a
  randomised experiment.

RULES TO STATE EXPLICITLY:
  - no percentage appears in the output unless it was in the input
  - "likely_cause" is always phrased as a hypothesis
  - if the transcript is missing, say the analysis is presence-only and note what
    that limits
-->
`;

F['src/llm/prompts/proposer.md'] = `
<!--
Weekly proposer prompt. Loaded by llm/proposer.mjs .

WRITE IT TO SAY, roughly:

  You receive aggregate statistics and validated findings across many real
  meetings. Propose a small number of specific, testable changes.

  Each proposal names one primary metric, the smallest effect worth detecting,
  and the sessions that motivated it. Propose changes that can actually be
  randomised - "start with the demo" can be assigned per meeting, "hire better
  presenters" cannot.

  Prefer three well-formed proposals to ten vague ones. You are writing a test
  plan someone will spend six weeks of real meetings executing.

RULES TO STATE EXPLICITLY:
  - never claim an effect size, only a direction and a minimum worth detecting
  - flag any proposal whose supporting evidence comes from fewer than five sessions
  - do not propose anything that requires seeing content you were not given
-->
`;

/* ───────────────────────────── experiments ───────────────────────────── */

F['src/experiments/registry.mjs'] = `
/**
 * Pre-registration. Write the hypothesis down BEFORE the meetings run.
 *
 * This file is the difference between a measurement and a story. Without it you
 * will run twenty meetings, look at the data, notice something, and report it as
 * a finding - and it will be noise about half the time.
 *
 * BUILD:
 *  - export register({ id, hypothesis, change, primary_metric, mde, arms,
 *                      n_required, owner })
 *      * n_required comes from power.mjs; refuse to register without it
 *      * write to ObsExperiment with status 'registered' and a frozen created_at
 *      * once status is 'running', reject edits to primary_metric or mde. That
 *        immutability IS the feature
 *  - export list(), get(id), close(id, { conclusion })
 *  - secondary metrics are allowed but must be declared up front and reported as
 *    exploratory, never as the headline
 */
`;

F['src/experiments/assign.mjs'] = `
/**
 * Randomised assignment of REAL meetings to arms. Runs before a meeting starts.
 *
 * BUILD:
 *  - export assign(meetingId, experimentId) -> { arm, decided_before_meeting: true }
 *      * deterministic hash of (meetingId + experimentId + salt) so a retry gives
 *        the same arm and cannot be re-rolled
 *      * write ObsAssignment immediately; the timestamp is the evidence that the
 *        arm was chosen before the meeting rather than after
 *      * refuse if the meeting has already started - log it, do not silently assign
 *  - export armFor(meetingId) -> the arm the host's UI should apply
 *  - block randomisation: if you run few meetings, assign in blocks of 4 (2 control,
 *    2 treatment shuffled) so the arms stay balanced at small N
 *  - stratify on anything that dominates the outcome and that you know in advance -
 *    registrant count, meeting type, host. Unstratified randomisation at n=30 can
 *    easily hand one arm all the big meetings
 *
 * THE HOST-SIDE HALF:
 *  armFor() has to actually change what happens in the meeting. Surface it in the
 *  host's console as a pre-meeting instruction ("this meeting: demo first, pricing
 *  after Q&A"). If the host ignores it, the arm is contaminated - record compliance
 *  as a field and report it. An experiment where nobody followed the instructions
 *  is not a null result, it is no result.
 */
`;

F['src/experiments/analyze.mjs'] = `
/**
 * The real effect estimate. Replaces the prototype's Monte Carlo entirely.
 *
 * The prototype simulated both arms. Here both arms are real meetings that
 * actually happened, so the statistics are ordinary and the honesty burden moves
 * to refusing to report early.
 *
 * BUILD:
 *  - export analyze(experimentId):
 *      1. load assignments and their sessions
 *      2. if n < n_required: return { effect: null, n, n_required,
 *         reason: 'underpowered' }. RETURN, do not compute. Peeking early and
 *         stopping when it looks good inflates false positives badly
 *      3. compute the primary metric per meeting (one number per meeting, not per
 *         participant - participants inside a meeting are correlated, and treating
 *         them as independent will make your CI about four times too narrow)
 *      4. difference in means between arms
 *      5. bootstrap 90% CI on that difference - port bootstrapCI from
 *         ../../engine/core.mjs, it is the one piece of the prototype that was
 *         real statistics
 *      6. return { effect, ci90, n_per_arm, metric, compliance_rate }
 *  - export observational({ sinceDays }) for the pre-experiment phase:
 *      correlations only, and every returned object must carry
 *      caveat: 'observational - not causal'. The console must print that caveat
 *      next to the number, not in a footnote
 *  - never report a p-value alongside an interval you already reported; pick one
 *    and stick to it. The interval is more useful here
 */
`;

F['src/experiments/power.mjs'] = `
/**
 * How many real meetings do you need? Run this BEFORE committing to an experiment.
 * Runnable directly: npm run power
 *
 * BUILD:
 *  - export requiredN({ baseline, mde, sd, alpha = 0.1, power = 0.8 })
 *      two-sample, per arm: n = 2 * (z_{1-alpha/2} + z_{power})^2 * sd^2 / mde^2
 *  - estimate sd from YOUR OWN historical sessions once you have a handful; until
 *    then say so and use a conservative default
 *  - CLI: print a small table of MDE (2, 5, 10 percentage points) against meetings
 *    needed per arm, and the calendar weeks that implies at your real meeting rate
 *
 * SET EXPECTATIONS HONESTLY WITH THIS OUTPUT.
 * Detecting a 5-point retention change usually needs tens of meetings per arm.
 * That is the real cost of a defensible number, and it is worth saying plainly in
 * the demo: this is why most teams never actually know whether their changes work,
 * and it is exactly the gap this project closes.
 */
`;

/* ─────────────────────────────── skills ─────────────────────────────── */

F['src/skills/promote.mjs'] = `
/**
 * Turns a finished experiment into a stored skill. The ONLY way a skill is created.
 *
 * BUILD:
 *  - export promote(experimentId):
 *      1. load analyze(experimentId)
 *      2. refuse if effect is null (underpowered)
 *      3. refuse if ci90 spans zero
 *      4. refuse if compliance_rate < 0.8 - the change was not really applied
 *      5. otherwise write ObsSkill with evidence pointing at the experiment id
 *  - every refusal returns a reason string that the console displays verbatim.
 *    The refusals are the most credible part of the demo: show one live
 *  - export demote(skillId, reason) for when a re-test fails; keep the history
 */
`;

F['src/skills/library.mjs'] = `
/**
 * Read/arm the skill library, and surface armed skills to hosts before meetings.
 *
 * BUILD:
 *  - export list({ armedOnly }) / arm(skillId, bool)
 *  - export briefingFor(meetingId) -> the plain-language pre-meeting checklist the
 *    host sees: which armed skills apply, and if this meeting is in an experiment,
 *    which arm it is in and what to do differently
 *  - export retest(skillId) -> registers a fresh experiment rather than re-running
 *    old numbers. A skill measured six months ago on a different audience is a
 *    hypothesis again, not evidence
 *  - track times_applied by counting real meetings whose arm included the skill,
 *    not by incrementing a counter when someone clicks a toggle
 */
`;

/* ─────────────────────────────── server ─────────────────────────────── */

F['src/server/app.mjs'] = `
/**
 * Entry point. Express + SSE. Start here: npm run dev
 *
 * BUILD:
 *  - connect Mongo, mount routes.mjs, listen on config.port
 *  - GET  /console            the host console (serve src/web/console.html)
 *  - GET  /api/live/:sessionId    SSE stream, host-authorised, see routes.mjs
 *  - POST /ingest             from your canvas Backend (shape B in socket-tap)
 *  - POST /api/beacon         from client-beacon.js
 *  - GET  /api/session/:id    session facts + report
 *  - GET  /healthz            for your existing CI/Terraform
 *  - graceful shutdown: flush the ingest buffer on SIGTERM or you lose the tail of
 *    every meeting on deploy
 *  - do NOT put business logic here. This file is wiring only.
 */
`;

F['src/server/routes.mjs'] = `
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
`;

F['src/server/mcp.mjs'] = `
/**
 * The same capabilities as MCP tools, over REAL data. Port from
 * ../../server/mcp.mjs - the JSON-RPC plumbing there is already correct and
 * protocol-compliant; only the handlers change.
 *
 * KEEP the transport: POST /mcp, JSON-RPC 2.0, initialize / tools/list /
 * tools/call, protocol version 2025-06-18.
 *
 * REPLACE every handler with a real query:
 *   sessions_list        recent real meetings
 *   session_status       live vitals for a meeting happening right now
 *   observe_stream       real rows since a seq cursor
 *   dataset_query        filter real rows
 *   dataset_export       real JSONL / CSV
 *   session_report       the validated analyst report
 *   experiment_register / experiment_assign / experiment_analyze
 *   skill_list / skill_promote / skill_arm
 *   nudge_host           push a nudge into a live meeting's host channel
 *
 * DELETE these prototype tools - they only made sense against a simulator:
 *   experiment_run (Monte Carlo), roi_portfolio, skill_transfer, surfaces_list
 *
 * Every tool that returns a metric must also return the n it rests on, and null
 * with a reason when n is too small. An agent consuming this API deserves the same
 * honesty as a human reading the console.
 */
`;

/* ─────────────────────────────── web ─────────────────────────────── */

F['src/web/console.html'] = `
<!--
  Host console. START BY COPYING ../../web/index.html and ../../web/style.css -
  the layout, the HUD, the dataset table and the CSS are all reusable as-is,
  because they only ever read the row schema.

  CHANGES NEEDED:
   - delete the surface picker and the speed controls (1x / 4x / 16x). There is no
     speed control on reality
   - delete the Experiments tab's Monte Carlo runner. Replace with a read-only
     experiment status panel: registered / running / n so far / n required
   - the ROI tab becomes "Measurements": either a real effect with its CI, or the
     honest "underpowered - 7 of 30 meetings" state. Build that empty state first,
     it is what you will actually be showing for the first month
   - add a REPORT tab for the analyst output, with every finding's cited_seqs
     rendered as clickable links that scroll to those rows in the Dataset tab.
     That link is the most persuasive thing in the whole product: the claim and the
     evidence, one click apart
   - the recording indicator must reflect real consent state, not a decoration
-->
`;

F['src/web/live.js'] = `
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
`;

/* ─────────────────────────────── patches ─────────────────────────────── */

F['patches/README.md'] = `
# Patches to your canvas repo

Two small changes to \`Real-Time-Collaborative-Digital-Canvas\`. Both are additive —
neither changes existing meeting behaviour, so a bug here cannot break your meetings.

1. \`socketHandler.patch.md\` — Backend/socket/socketHandler.js
2. \`Meeting.jsx.patch.md\` — Frontend/pages/Meeting.jsx

Apply on a branch. Verify Phase 1's acceptance test before merging.
`;

F['patches/socketHandler.patch.md'] = `
# Patch: Backend/socket/socketHandler.js

Goal: every meeting event your server already handles also gets forwarded to
Backstage. Additive only.

## 1. At the top

~~~js
import { emitToBackstage } from '../backstage/emit.js'; // small helper you add
~~~

\`emitToBackstage(type, { meetingId, actor, payload })\` should:
- POST to \`\${BACKSTAGE_URL}/ingest\` with the \`X-Backstage-Secret\` header
- be **fire-and-forget**: no await in the socket handler, catch and swallow errors,
  1s timeout. Your meeting must never slow down or fail because Backstage is down

## 2. At each existing handler, add one line

Find the places you already handle these and add the emit alongside — do not
restructure the handlers:

| Your existing event | Add |
| --- | --- |
| socket joins a meeting room | \`emitToBackstage('participant.join', {...})\` |
| \`disconnect\` | \`emitToBackstage('participant.leave', { reason: 'socket_disconnect' })\` |
| explicit leave button | \`emitToBackstage('participant.leave', { reason: 'left_meeting' })\` |
| chat message broadcast | \`emitToBackstage('chat.message', { text, len })\` |
| canvas draw/stroke | \`emitToBackstage('canvas.stroke', {...})\` **debounced** |
| screen share start/stop | \`emitToBackstage('screenshare.start' / '.stop', {})\` |
| mic / camera toggle | \`emitToBackstage('mic.toggle' / 'camera.toggle', { on })\` |
| new \`backstage:signal\` from the beacon | forward payload.type through as-is |

## 3. Debounce the canvas

Canvas strokes fire many times per second per user. Batch per actor into one emit
every 5 seconds carrying \`{ stroke_count, ms_active }\`. Skipping this floods the
dataset and the LLM context with noise that carries almost no information.

## 4. Add the new listener

~~~js
socket.on('backstage:signal', (payload) => {
  // payload.type is one of: tab.hidden | tab.visible | window.blur |
  // window.focus | idle.start | idle.end
  emitToBackstage(payload.type, { meetingId, actor: socket.userId, payload });
});
~~~

## Acceptance

Run a real 2-person meeting. \`db.observationevents.countDocuments()\` > 0, with a
real \`participant.join\` and \`participant.leave\` at true wall-clock times.
`;

F['patches/Meeting.jsx.patch.md'] = `
# Patch: Frontend/pages/Meeting.jsx

Two additions: the consent banner, and the beacon.

## 1. Consent banner — build this FIRST

Before any transcript or recording row is written, every participant must have
consented. Recording and transcribing people without consent is unlawful in many
jurisdictions, and it is the fastest way to kill this project inside a company.

~~~jsx
{!consentGiven && (
  <ConsentBanner
    onAccept={() => { setConsentGiven(true); socket.emit('backstage:consent', { accepted: true }); }}
    onDecline={() => { socket.emit('backstage:consent', { accepted: false }); }}
  />
)}
~~~

The banner must state plainly, in the participant's words:
- what is recorded: joins, leaves, chat, canvas activity, and whether this tab is
  in front of you
- what is **not**: your screen, your keystrokes, your other tabs, your camera feed
- who sees it: the meeting host only
- that declining leaves the meeting fully usable — and make that true. A consent
  prompt with no real second option is not consent

Persist per participant in \`ObsSession.participants[].consent\`. On decline, still
record presence (join/leave) if your terms cover it, but write **no** transcript
and no beacon rows for that person.

## 2. Mount the beacon

~~~jsx
useEffect(() => {
  if (!consentGiven || !socket) return;
  const stop = startBeacon({ socket, meetingId, userId });
  return stop;   // required: React StrictMode mounts twice in dev
}, [consentGiven, socket, meetingId, userId]);
~~~

## 3. Host-only console link

Show a "Companion" button **only when \`user.id === meeting.hostId\`**, opening
\`/console?meeting=<id>\` in a new tab. Gate it in the backend too — a hidden button
is not access control.

## Acceptance

Join as host in one browser and as a participant in another. The participant sees
the consent banner and no companion UI whatsoever. The host sees the button. Switch
the participant to another tab for ten seconds: a \`tab.hidden\` and a \`tab.visible\`
row appear in Mongo.
`;

/* ─────────────────────────────── scripts ─────────────────────────────── */

F['scripts/export-dataset.mjs'] = `
/**
 * CLI: npm run export -- --since 30 --out ./data/meetings.jsonl
 *
 * BUILD:
 *  - connect, resolve session ids by date range or explicit --session
 *  - refuse to export a session whose labels_backfilled is false; tell the user to
 *    run npm run backfill first. Exporting unlabelled rows produces a file that
 *    looks fine and trains nothing
 *  - call store/dataset.exportJSONL, then print stats(): sessions, rows, labelled,
 *    positives, class balance
 *  - write a sidecar .meta.json next to the export: date range, session ids, the
 *    outcome definition used, git sha. In six months this is the only thing that
 *    will let anyone interpret the file
 */
`;

F['scripts/backfill-labels.mjs'] = `
/**
 * CLI: npm run backfill -- --session <id>   (or --all)
 *
 * BUILD:
 *  - for each ended session, call store/dataset.backfillLabels
 *  - idempotent: safe to re-run over already-labelled sessions
 *  - refuse sessions with no ended_at - a meeting still running has no labels yet,
 *    by definition
 *  - print per session: rows updated, churn positives, outcome positives
 */
`;

/* ─────────────────────────────── write ─────────────────────────────── */

let n = 0;
for (const [rel, body] of Object.entries(F)) {
  const p = path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body.replace(/^\n/, ''));
  n++;
}
console.log('wrote ' + n + ' files');

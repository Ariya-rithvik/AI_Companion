# Backstage Live — build plan (real data, real LLM, no simulation)

> **Read this first.** Every file under `src/` is a stub whose comments are the spec.
> Build in phase order. Each phase has an acceptance test you can actually run.
> Nothing here simulates anything. If a number cannot be measured yet, the code must
> return `null` with a reason — never a plausible-looking placeholder.

---

## 0. What we are attaching to

You own the meeting platform:
`https://github.com/VENKATARAMANA-T/Real-Time-Collaborative-Digital-Canvas`

```
Backend/socket/socketHandler.js            <- Socket.io manager + meeting events   ** MAIN TAP **
Backend/models/Meeting.js                  <- meeting schema, participants
Backend/controllers/meetingController.js   <- join / leave / recording
Backend/routes/meetingRoutes.js
Frontend/pages/Meeting.jsx                 <- meeting room page                    ** BEACON **
Frontend/components/Meeting/*.jsx          <- Canvas, ChatBox, VideoPlayer, Sidebar
```

Stack already present: Node + Express, Socket.io, MongoDB + Mongoose, React 18 + Vite,
Cloudinary (recordings), Groq SDK (LLaMA 3.3 70B).

**This is the whole reason the project can be real.** We are not scraping a meeting we do not
control — we are instrumenting one we own. Every presence and engagement signal below already
flows through your socket layer. We only record it in a labelled shape.

---

## 1. Real vs. not-yet-real — say this out loud in the demo

| Capability | Real on day 1? | What it needs |
| --- | --- | --- |
| Presence: join / leave / duration / rejoin | **Yes** | tap `socketHandler.js` |
| Engagement: chat, canvas strokes, screenshare, mic/cam toggles | **Yes** | same tap |
| Attention proxy: tab hidden, window blur, idle, camera off | **Yes** | `client-beacon.js` in `Meeting.jsx` |
| Real transcript + who spoke | **Yes** | STT on the Cloudinary recording, or live |
| LLM moment detection + live host nudges | **Yes** | `llm/observer.mjs` |
| LLM post-meeting report | **Yes** | `llm/analyst.mjs` |
| Labelled dataset (JSONL), growing per meeting | **Yes** | `store/dataset.mjs` |
| Correlations ("leaves spike after minute 22") | ~5 meetings | `experiments/analyze.mjs` |
| **Causal** "this change caused +X%" | **NO** | randomised assignment over **~30-60 real meetings** |
| An ROI % you can defend | **NO** | the above, plus real deal values from your CRM |

The honest pitch is stronger than the simulated one: *"Observation and analysis are real today.
The lift number is a measurement we are collecting, and here is the exact experiment design
that produces it."*

---

## 2. Architecture

```
Your meeting server  --emit-->  socket-tap.mjs  --+
Browser beacon       --POST-->  routes.mjs      --+--> normalize.mjs --> MongoDB
Recording / STT      --job--->  transcript.mjs  --+                        |
                                                                          +--> llm/observer.mjs --> host-only nudge (SSE)
                                                                          +--> llm/analyst.mjs  --> post-meeting report
                                                                          +--> store/dataset.mjs --> JSONL for training
                                                                          +--> experiments/*     --> assignment + effect
                                                    server/mcp.mjs --> all of the above as MCP tools
```

One row schema for every source, identical to the one the prototype console already renders:

```json
{ "seq": 0, "t": 0, "ts": "00:00", "session_id": "", "surface": "meeting",
  "type": "", "actor": "", "stage": "", "payload": {}, "features": {}, "label": {} }
```

---

## 3. Phases — build in this order

### Phase 1 — Ingest (no LLM, no UI, no stats)
`src/config.mjs`, `src/store/mongo.mjs`, `src/store/models.mjs`, `src/ingest/normalize.mjs`,
`src/ingest/socket-tap.mjs`, `src/ingest/client-beacon.js`, `patches/*.md`

**Acceptance:** run a real 2-person meeting on your app. `db.observationevents.countDocuments()`
returns > 0 and contains a real `participant.join` and `participant.leave` with true wall-clock
timestamps. Do not start Phase 2 until this passes.

### Phase 2 — Live console on real events
`src/server/app.mjs`, `src/server/routes.mjs`, `src/web/console.html`, `src/web/live.js`

**Acceptance:** host opens `/console?meeting=<id>`; a second person joins then leaves; it appears
in the console within 2 seconds, and **only** in the host's window.

### Phase 3 — Transcript
`src/ingest/transcript.mjs`

**Acceptance:** after a meeting ends, `speech.segment` rows exist with real text and speaker ids.

### Phase 4 — LLM companion (the "AI is really there" part)
`src/llm/client.mjs`, `src/llm/schemas.mjs`, `src/llm/observer.mjs`, `src/llm/analyst.mjs`,
`src/llm/prompts/*.md`

**Acceptance:**
1. During a live meeting the observer emits at least one nudge quoting a real event from the
   last 3 minutes.
2. After the meeting the analyst returns JSON whose every claim cites `event_seq` values.
3. A validator **rejects any claim citing a seq not in the DB**. That gate is the difference
   between an analyst and a plausible-sentence generator.

### Phase 5 — Dataset + observational analysis
`src/store/dataset.mjs`, `src/experiments/analyze.mjs`, `scripts/*.mjs`

**Acceptance:** `npm run export` writes JSONL where every participant row carries a back-filled
`label.churn_next` and `label.outcome` computed from what really happened.

### Phase 6 — Real experiments (the only honest path to an ROI number)
`src/experiments/registry.mjs`, `src/experiments/assign.mjs`, `src/experiments/power.mjs`,
`src/skills/promote.mjs`, `src/skills/library.mjs`

**Acceptance:** `power.mjs` prints the number of meetings needed for the effect you care about;
`assign.mjs` randomises real meetings into arms **before** they run; `analyze.mjs` refuses to
report an effect until the pre-registered N is reached.

### Phase 7 — Memory across meetings
`src/memory/store.mjs`, `src/memory/consolidate.mjs`, `src/memory/cues.mjs`

This is what makes it a companion rather than a dashboard, and it is already built and working
in the prototype (`../engine/memory.mjs`) — port it, do not redesign it. See
`src/memory/README.md`.

**Acceptance:** run four real meetings. Before the fifth, the console shows patterns with their
denominators, and during it at least one cue fires **before** the stage it warns about, tagged
as coming from memory and citing the meetings it came from.

---

## 4. LLM choices — cost matters, this runs per meeting

| Job | Model | Why | Rough cost |
| --- | --- | --- | --- |
| Live observer, every 30–60s | `claude-haiku-4-5-20251001` | cheap, fast, small window | cents / meeting |
| Post-meeting analyst | `claude-sonnet-5` | long context, structured output | ~$0.05–0.20 / meeting |
| Lever proposer (weekly, across meetings) | `claude-opus-5` | hardest reasoning, runs rarely | a few $ / week |
| Fallback you already own | Groq LLaMA 3.3 70B | already wired in your repo | — |

Use prompt caching on the system prompt and the meeting preamble. The observer re-sends the
same preamble every 30s; caching cuts that cost by roughly an order of magnitude.

---

## 5. Hard rules for whoever implements this

1. **Never invent a metric.** If N is too small, return `{ value: null, reason: "n=3, need 30" }`.
2. **Every LLM claim cites event seqs**, validated against the DB. Drop uncited claims.
3. **Consent is not optional.** Recording and transcribing people requires their consent and in
   many places it is the law. `Meeting.jsx` must show a visible banner and store per-participant
   consent *before* any transcript row is written. Build this in Phase 1, not later.
4. **Host-only.** Nudges go over an SSE channel authorised by the host's JWT. Never emit them
   into the shared Socket.io room — one broadcast bug and every attendee sees their own churn score.
5. **Pre-register experiments.** Hypothesis and N go in `registry.mjs` before the run. Reading
   the data first and then picking a winner is exactly how you get a fake 35%.
6. **Keep the row schema stable.** Console, exporter and MCP server all depend on it.

---

## 6. What to carry over from the prototype, and what to delete

Keep exactly two things from `../engine/`:

- the **row schema** — `normalize.mjs` reproduces it
- the **bootstrap CI** — `experiments/analyze.mjs` reuses it; that is real statistics

Delete the rest: the hazard model, the lever tables, the Monte Carlo, the seeded skill library.
All of it is simulation and must not be carried into this project. The console UI
(`../web/*`) can be reused as-is, because it only ever reads the row schema.

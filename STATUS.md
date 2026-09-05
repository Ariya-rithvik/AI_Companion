# Status — what is done, what is left

Verified by running everything, not from memory. Re-verify any time with:

```bash
npm run check     # dependency invariants — exits non-zero if anything is broken
npm run bench     # the incrementality result
npm run build     # standalone bundle
npm start         # console on :8787, meeting room on :8787/meeting
```

All five currently pass.

---

## DONE — working and tested

| Thing | Where | Evidence |
| --- | --- | --- |
| **Simulation engine** — cohort → stages → hazard → outcome, 6 surfaces | `engine/core.mjs`, `surfaces.mjs` | `npm run calibrate` |
| **Bootstrap CI + promotion gate** — refuses effects that span zero | `engine/core.mjs` | verdicts in the lab |
| **Skill library** with measured evidence, regenerable | `engine/library.mjs`, `tools/seedskills.mjs` | re-run regenerates it |
| **Memory** — episodes → patterns → timed cues that fire *early* | `engine/memory.mjs` | cue at 26:15 for a 29:30 event |
| **Operator console** — 7 tabs, light/dark, professional palette | `web/` | `npm start` |
| **Floating AI companion** — shadow-DOM overlay, boot sequence, orb, gauges | `web/companion.js` | ⬡ button in either page |
| **Live meeting room** — real WebRTC, socket.io, 6 participants | `web/meeting-room.html`, `server/meeting-server.mjs` | `:8787/meeting` |
| **Companion in the meeting** — real joins/leaves via MutationObserver | `web/companion-meeting.js` | selectors asserted at mount |
| **Web MCP server** — 18 tools, JSON-RPC 2.0, protocol 2025-06-18 | `server/mcp.mjs` | `POST /mcp` |
| **Incrementality engine** — CVT uplift, Qini, quadrants, budget policy | `razorpay/` | `npm run bench` |
| **Code knowledge graph** — impact analysis + build invariants | `tools/graph.mjs` | `npm run check` |
| **Real-build scaffold** — 40 spec files, 7 phases | `backstage-live/` | comments are the spec |

### Fixed this session

- **`web/meeting-room.html` was corrupted.** Double-encoded via CP1252 — the page served
  `ðŸŽ™ï¸` instead of 🎙️. Repaired with `tools/fix-encoding.mjs`; 38 emoji restored, matching
  git HEAD exactly, with the newer palette changes preserved. *(My fault — an earlier
  PowerShell `Get-Content | Set-Content` round-trip.)*
- **Server sent `text/html` with no charset** — would cause mojibake even on a clean file.
  All text MIME types now declare `charset=utf-8`.
- **`companion-meeting.js` was written against the wrong file.** It targeted ids from
  `web/meeting.js` — an orphan nothing loads — so it looked for `#topbar` when the live page
  uses `.topbar` as a class. It was silently mounting its button onto `<body>`. Now every
  selector is read off the live page and asserted at mount.
- **Two bugs in the graph tool itself**, found by using it: it matched imports inside regex
  literals, and it skipped HTML `src="x.js"` because that has no leading `./`.

---

## THE GRAPH — the thing you asked for

```bash
npm run check                          # gate: 0 errors or it fails
node tools/graph.mjs                   # the whole map
node tools/graph.mjs impact engine/core.mjs
node tools/graph.mjs mermaid           # diagram for the docs
```

`impact` answers exactly the question you raised — *if I change this file, what else breaks?*

```
CHANGING  engine/core.mjs
  └─ web/app.js          └─ server/mcp.mjs      └─ tools/calibrate.mjs
  └─ tools/seedskills.mjs └─ integrations/events.mjs
    └─ web/index.html    └─ server/realtime.mjs
  RE-TEST   web/app.js, server/mcp.mjs, web/index.html
  ALSO      this file is flattened into dist/ — run the bundler after
```

`check` encodes the three bugs that actually bit us, so they cannot come back quietly:
a module app.js needs but the bundler does not inline; two flattened modules declaring the
same top-level name; an import of a name nothing exports.

**Run `npm run check` after every change.** It is fast and it is a real gate.

---

## Can it observe a real Zoom call?

Straight answer, three parts:

**Your own meeting room: yes, today.** `/meeting` is real WebRTC with real socket.io. The
companion reads genuine joins, leaves and dwell from the DOM the meeting itself renders. Open
it in two browsers and it works now.

**Zoom, by opening zoom.us in a tab: no, and nothing will make that work.** A web page cannot
observe another site's meeting. Any demo claiming otherwise is faking it.

**Zoom, properly: yes, via their APIs — but it is a downgrade.** Two routes:
- *Webhooks* (`meeting.started/ended`, `participant_joined/left`, `recording.completed`) — a
  Marketplace app, server-side, real. Enough for presence and the dataset. Spec is already in
  `backstage-live/src/ingest/zoom-adapter.mjs`.
- *Meeting SDK / RTMS bot* — joins the call, gets media and chat. Much heavier.

**Zoom gives you no attention signal, no canvas activity, and no chat without a bot.** Your own
platform gives you all three plus per-participant permissions. Build on yours; treat Zoom as a
"works with Zoom too" checkbox, not the main path.

---

## NOT DONE — in priority order

### 1. Razorpay test-mode loop  ← blocks the whole submission
Track 01 says *"on Razorpay test-mode APIs"*. Right now there is no Razorpay call anywhere.
Spec: **T1** in `TASKS.md`. Without this it is a simulation with a Razorpay-shaped hole.

### 2. Calibration panel — predicted vs measured
The most persuasive screen you can show, and the one a simulation cannot fake.
Spec: **T2** in `TASKS.md`. Depends on 1.

### 3. Real ingest from your canvas repo
`backstage-live/` Phases 1–2: tap `socketHandler.js`, consent banner, browser beacon, live
console on real events. Spec: **T5** + `patches/`.

### 4. Decide what to do about two loose ends
- `web/meeting.js` — 652 lines nothing loads, with features the live inline copy lacks. Either
  delete it or extract the inline script into it. **Right now it is a trap**: edit it and
  nothing happens.
- `web/lingo/` — reachable at `/lingo/index.html`, returns 200, throws on load. `ui.js` and
  `tools.js` were never committed. Finish it or stop serving that route before you demo.

### 5. Growth Council, transcript, uplift upgrade, pitch assets
**T3, T4, T6, T7** in `TASKS.md`.

---

## Split of work

**Send to the other account** (self-contained, verifiable, no shared files):
T1 Razorpay adapter · T2 calibration · T5 consent+beacon · T6 transcript · T7 pitch assets.
Each has a copy-paste prompt and a pass/fail test in `TASKS.md`.

**Keep for the strong model:** the honesty gates (`MIN_EPISODES`, promotion gate, the
"refuse when underpowered" paths), memory consolidation, and the experiment design in
`backstage-live/src/experiments/`. A subtle mistake there produces a *confident wrong number*,
which is the one failure this project cannot survive.

**Rule for anyone touching the code:** run `npm run check` before and after. If `impact` says a
file is flattened into `dist/`, run `npm run build` too.

<!-- encoding-sweep:ignore - this file quotes mojibake deliberately, to document the bug -->

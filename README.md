# Backstage — a companion for any work surface

An AI companion that attaches to whatever you are running — a live call, a checkout, a trial
cohort, a support queue, a review pipeline, a docs page — watches everything, turns what it
sees into a labelled dataset, runs experiments on that dataset, and keeps the ones that win.

Four things, in one loop, on six surfaces:

1. **Observe.** An operator-only console renders beside the work. The people on the other side
   see their meeting, their checkout, their queue exactly as they do today. Arrivals, exits,
   dwell, signals, and a derived focus / churn-hazard / intent estimate land only in your window.
2. **Record.** Every signal becomes one labelled row, and all six surfaces share one schema.
   Labels are back-filled when the run closes — that is what makes the file trainable.
3. **Experiment.** Replay a run hundreds of times with and without a change, on matched seeds,
   and read the mean lift with a bootstrap 90% interval on that mean.
4. **Promote.** An experiment whose interval clears zero becomes a **skill**: an armed rule that
   carries its own evidence. Skills compound, and a skill learned on one surface can be tested
   against another.

Everything above is an MCP tool, and every tool takes a `surface`.

## Why WebMCP fits this project

Meeting participants create the evidence through ordinary work: joining, speaking, chatting,
reacting, and leaving. WebMCP lets an agent inspect that live evidence through typed tools,
ask for the right slice of the labelled dataset, and compare an intervention without taking
control away from the people in the meeting. People create the signals; agents turn those
signals into analysis, recommendations, experiments, and reusable skills.

The live meeting room is available at `/meeting`, while the operator console and its WebMCP
endpoint are available at `/` and `/mcp`. The meeting event feed is real WebRTC plus Socket.io;
the six-surface experiment lab remains explicitly labelled as a calibrated model rather than
measured production results.

## Why one model covers all six

Each surface turns out to be the same shape underneath: **a cohort of actors moves through
ordered stages, each stage carries a hazard of dropping out, engagement raises intent, and
intent plus survival produce an outcome worth money.**

| Surface | Actor | Drop looks like | Outcome |
| --- | --- | --- | --- |
| Webinar / live meeting | attendee | leaving at the pricing slide | MQL |
| Checkout funnel | shopper | abandoning at the shipping cost | purchase |
| Product onboarding | trial | never reaching a first run | activation |
| Support queue | ticket | ageing out to escalation | clean resolution |
| Code review pipeline | pull request | stalling in review | merged PR |
| Docs & content | reader | bouncing off the config wall | integration |

So `engine/core.mjs` knows about actors, stages, hazard, signals and outcomes — and nothing
about webinars. `engine/surfaces.mjs` supplies the nouns, stage table, levers and economics.
Adding a seventh surface is a data change.

## Run it

```bash
node server/mcp.mjs
```

```
console   http://localhost:8787/
web mcp   http://localhost:8787/mcp   (18 tools, protocol 2025-06-18)
surfaces  webinar, checkout, onboarding, support, codereview, docs
```

Node 18+. No dependencies, no install step.

For a single file you can double-click or host anywhere:

```bash
node tools/bundle.mjs
```

`dist/backstage-demo.html` inlines all four modules. With no server reachable it falls back to
the in-page engine and the MCP tab says so.

## The demo, in order

| Tab | What to show |
| --- | --- |
| **Live** | Pick a surface in the modal. On a webinar you get attendee tiles greying out; on the other five you get the survivor flow board filling stage by stage with the top drop reason. Same console, six vocabularies. |
| **Dataset** | Hundreds of rows per run with `features` and back-filled `label` — and switching surface changes only the vocabulary, never the schema. JSONL and CSV export. |
| **Experiments** | On the webinar, tick *Move pricing after Q&A*: it comes back **positive on ROI and negative on retention**. Raise or lower the run count and watch the interval tighten or widen — it is a real interval on the mean, not a spread. |
| **Skills** | Three per surface, each with its evidence. Hit **try on → support** under a code-review skill: it re-runs on the queue and reports whether it held. |
| **ROI** | *This surface* gives the waterfall. **All surfaces** is the point of the build. |
| **MCP** | The live tool catalogue from `tools/list`, and the JSON-RPC traffic the UI just generated. |

## What the portfolio says

Armed library vs baseline, 60 paired runs per arm per surface:

| Surface | ROI lift | 90% CI | Retention | Outcomes |
| --- | --- | --- | --- | --- |
| Webinar | **+43.9%** | 39.5 … 48.3 | −5.1% | MQLs +44.5% |
| Docs & content | **+36.1%** | 33.5 … 38.9 | +11.3% | integrations +34.1% |
| Product onboarding | **+32.4%** | 29.3 … 35.5 | +8.5% | activations +23.9% |
| Checkout funnel | **+24.7%** | 22.2 … 27.8 | +15.2% | purchases +24.8% |
| Code review | **+14.7%** | 13.0 … 16.2 | +6.6% | merged PRs +10.8% |
| Support queue | **+14.3%** | 13.5 … 15.1 | +4.3% | clean resolutions +10.9% |

The spread is the finding, not the headline. Surfaces already running well — a queue resolving
77% of tickets cleanly, a pipeline merging 79% of PRs — have little headroom, and the library
is worth low double digits there. Leaky surfaces have far more. A companion that only watched
webinars could not have told you that.

## Call it as an agent

```bash
curl -s localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"skill_transfer",
                 "arguments":{"skill_id":"skill_codereview:auto_assign","to":"support"}}}'
```

```json
{ "transferable": true, "from": "codereview", "to": "support",
  "source_skill": "Auto-assign a reviewer on open", "source_lift_pct": 7.28,
  "target_lever": "auto_triage", "target_label": "Companion auto-triage on arrival",
  "target_lift_pct": 6.4, "ci90": [5.75, 7.03], "verdict": "keep" }
```

Tools: `surfaces_list` · `session_start` · `session_advance` · `session_status` ·
`observe_stream` · `capture_moment` · `dataset_query` · `dataset_export` ·
`experiment_levers` · `experiment_run` · `experiment_list` · `skill_list` · `skill_promote` ·
`skill_arm` · `skill_transfer` · `roi_report` · `roi_portfolio` · `nudge_operator`

## Layout

```
engine/core.mjs        the kernel — actors, stages, hazard, outcomes, Monte Carlo. No surface knowledge.
engine/surfaces.mjs    six surface packs. Pure data against one contract.
engine/library.mjs     the shipped skills, with the evidence they were promoted on.
server/mcp.mjs         Web MCP server (JSON-RPC over HTTP) + static host.
web/                   the operator console.
tools/calibrate.mjs    baseline + per-lever numbers for every surface.
tools/seedskills.mjs   regenerates engine/library.mjs from measurement.
tools/bundle.mjs       inline everything into dist/.
```

## What is real and what is simulated

The pipeline is real: observation → labelled rows → paired Monte-Carlo → promotion gate →
armed skill → compounded report → cross-surface transfer. It is about 900 lines across
`engine/`, and the same code runs in the browser, in the MCP server, and in the calibration
harness.

**The actors are simulated.** There is no Zoom, Stripe or GitHub SDK behind this, and the
numbers are not measured results. A real deployment would refit these constants on its own
observation dataset after a handful of runs. Three things are deliberate rather than convenient:

- **Effects were tuned down, not up.** Most single levers are worth single digits. Only a
  compounded library reaches the thirties, and each stacked skill is damped `0.86×`.
- **The promotion gate really rejects.** The first version of it gated on the *spread* of
  individual runs — a prediction interval, which never shrinks with more runs. That is the
  wrong statistic twice over: it rejects real effects and makes the "runs" control decorative.
  It now bootstraps a confidence interval on the mean, so `n` genuinely matters.
- **The portfolio is uneven on purpose.** Forcing all six surfaces to the same headline number
  would have been easy and dishonest.

To wire a surface to reality, replace the tick loop with that system's event feed — Zoom
participants, Stripe checkout events, GitHub PR webhooks, Zendesk tickets. The row schema, the
labels, the lab, the library and the transfer machinery do not change.

## Known edges

- `outcomeScore` treats anyone still present mid-run as fully retained, so the live
  **Exp. outcomes** vitals reads as a projection and only settles at close.
- The MCP server keeps one session per surface in memory. Multi-tenant would need a session map
  keyed on `Mcp-Session-Id`, which the endpoint already accepts as a header.
- `GET /mcp` opens an SSE channel and heartbeats, but no server-initiated notifications are
  pushed through it yet.
- `skill_transfer` maps a source lever to its target counterpart by the `transfers` declaration
  on each lever. That is a hand-authored adjacency, not a learned one.

# AI_Companion

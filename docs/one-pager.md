# Backstage — One-Page Summary

**An AI companion that attaches to whatever you are running, watches everything,
turns what it sees into a labelled dataset, runs experiments on that dataset,
and keeps the ones that win.**

---

## The key result

Blanket discounting loses **₹0.65 per rupee** spent. The industry-standard
propensity model — targeting people most likely to buy — still loses **₹0.59**.
Only incrementality targeting flips the sign to **+₹0.38** per rupee.

Same audience size (1,234 of 5,600). 78% fewer discounts. ₹8.6L more net margin
vs discounting everyone.

> Reproduced with `npm run bench`. Qini coefficient 29.4 on untouched validation split.

---

## What is built

| Component | Where | Evidence |
|---|---|---|
| **Simulation engine** — 6 surfaces, bootstrap CI, promotion gate | `engine/` | `npm run calibrate` |
| **Incrementality engine** — CVT uplift, Qini, four quadrants, gated policy | `razorpay/` | `npm run bench` |
| **Razorpay test-mode wrapper** — orders, payment links, webhooks | `razorpay/rzp.mjs` | `node razorpay/demo.mjs` |
| **Operator console** — 7 tabs, dark mode, AI companion | `web/index.html` | `npm start` |
| **Live meeting room** — WebRTC, 6 participants, local recording | `web/meeting-room.html` | `:8787/meeting` |
| **Web MCP server** — 18 tools, JSON-RPC 2.0 | `server/mcp.mjs` | `POST /mcp` |
| **Memory** — episodes → patterns → timed cues that fire early | `engine/memory.mjs` | cue at 26:15 for a 29:30 event |
| **Code knowledge graph** — impact analysis + build invariants | `tools/graph.mjs` | `npm run check` |

28 modules · 0 errors · 0 known gaps.

---

## How it works

One model covers six surfaces because the shape underneath is the same: **a cohort
of actors moves through ordered stages, each stage carries a hazard of dropping out,
engagement raises intent, and intent plus survival produces an outcome worth money.**

| Surface | Outcome | Portfolio ROI lift |
|---|---|---|
| Product onboarding | activation | **+30.2%** |
| Docs & content | integration | **+24.8%** |
| Webinar | MQL | **+22.1%** |
| Code review | merged PR | **+13.5%** |
| Support queue | clean resolution | **+13.5%** |
| Checkout funnel | purchase | **+9.2%** |

The spread is the finding: surfaces already running well have less headroom.

---

## What is real and what is simulated

**Real:** the pipeline (observation → labelled rows → Monte Carlo → promotion gate →
armed skill → compounded report → cross-surface transfer), the incrementality method,
the evaluation (three-way split, Qini on untouched data), the Razorpay API calls,
the WebRTC meeting with recording, the LLM-powered AI nudges.

**Simulated:** the actors. The six surfaces run on a calibrated model, not live vendor SDKs.
Numbers are from a calibrated model, not measured production results. Effects were
tuned down, not up.

---

## Run it

```bash
npm start          # console + meeting room on :8787
npm run bench      # incrementality result
npm run check      # dependency invariants (0 errors required)
```

Architecture: `node tools/graph.mjs mermaid` or see `docs/architecture.svg`.

# Demo runbook

## First: the payment path is Razorpay, end to end

Do not raise other providers in the pitch. Lead with what we use, and be ready to show it:

```bash
grep -rln "api.razorpay.com\|RAZORPAY_KEY" --include=*.mjs .
# razorpay/rzp.mjs   — 8 live call sites
```

`razorpay/rzp.mjs` is the only payment integration in the repo: orders, payment links, and HMAC
webhook verification against `api.razorpay.com`. There is no second payment SDK, and
`package.json` has no payment dependency at all — the adapter is written directly against the
REST API with `node:crypto`.

**Four patterns came from Aegis, our own earlier internal agent framework — architecture,
not code:**

| Pattern | Where it lives now |
| --- | --- |
| sha256 idempotency, checked before the upstream call | `razorpay/policy.mjs` |
| verbatim failure, never a synthesised `external_ref` | `razorpay/policy.mjs` |
| pure governance rules that gate money on visible arithmetic | `razorpay/pacer.mjs` |
| every claim cites the record it rests on | `razorpay/explain.mjs` |

Nothing from that framework ships here. It was never cloned into this repo, and every one of
those four patterns was rewritten against Razorpay from scratch.

**If a judge asks whether this is ported from a prior project, say:** *"Four architectural
patterns come from our own earlier internal agent framework. We reimplemented all of them
against Razorpay. The payment integration here is Razorpay only, written directly against the
REST API."*

Then move on. Do not volunteer the comparison — it is not the interesting part of the submission,
and naming a competitor in their own building is a needless own goal.

---

## Before you record

One command checks the whole runbook, with all 12 environment variables deleted from
the child processes — so it proves the demo works on a laptop that has never seen
this repo's `.env`:

```bash
npm run demo:check
```

Expect **18/18 PASS** and the closing line *"ALL STEPS PASS WITH ZERO API KEYS."*
If any step fails, do not record until it is green.

It covers: recover, calibration, both test suites, graph, encoding, bench, build,
both credential paths, all four served pages, three MCP calls, and a 404.

**API keys: you need none.** Not for any step above, not for the run order below.
`.env.example` lists what the two optional ones unlock. The only step that touches
the network is step 5, which is optional and aborts cleanly without keys.

**If port 8787 is busy** (an earlier `npm start` still running) the server now says so
and exits, rather than printing a stack trace:

```bash
PORT=8788 npm start      # or: npx kill-port 8787
```

## The run order

### 1 · The result — `npm run recover`

Have it **already run** and scrolled to the MEASURE table. Do not make anyone watch it compute.

Point at the propensity row: **−₹23,329.** Pause there.

> "Targeting by who's most likely to pay loses money. It's worse than doing nothing."

Then the archetype table:

```
nudge_needed     518   contacted 80%   +33.0pp
self_recoverer   431   contacted  2%    +2.0pp
annoyed          223   contacted  0%   -11.5pp
```

> "It was never told these labels. Zero percent of the people who cancel when chased."

### 2 · Calibration — `node razorpay/calibration.mjs`

> "Ranking right isn't enough. Decile 1 predicted +18.6, delivered +14.8. Decile 10 predicted
> minus five, delivered minus five point six. Mean error under three points."

Point out the deciles where the interval spans zero. Say that out loud — it is the reason to
believe the rest.

### 3 · Governance — scroll up in the same `recover` output

> "On our run the pacer catches nothing, because the gates already did. So we point the same
> rules at the list that lost money: **121 of 552 would be halted.**"

### 4 · One audit brief

Read C7747 aloud. Then: *"zero claims dropped — every sentence traces to evidence."*

### 5 · Live — only if your keys authenticate

```bash
node --env-file=.env razorpay/recover.mjs --live
```

**Run this once before you record.** With working test keys it creates three real
test-mode payment links. With missing or placeholder keys it prints:

> **LIVE ABORTED — the keys in .env do not authenticate.** `Razorpay 401: Authentication failed`

That is a safe outcome, not a crash — but do not discover it on stage. If you do
not have working keys, **cut this step** and say the honest version instead:

> "The adapter is written against the REST API and its signature verification is
> unit tested — eight cases including a tampered body. The batch you just saw
> needs no network at all."

Do not claim live links were created unless you watched three `OK` lines appear.

### 6 · One failure, handled

```bash
# in another terminal
npx kill-port 8787      # or just stop the server
```

Click **Create New** in the meeting room:

> **"Could not create the room: websocket error. Is the server running?"** — red, button still
> usable, socket closed.

That is Track 01's *"one failure handled gracefully"*, and Track 03's stopping-rule discipline,
in one click.

### 7 · The companion (30 seconds, optional)

`npm start` → `http://localhost:8787/` → **⬡ AI Companion**. Boot sequence, gauges, and a cue
that fires *before* the drop-off it warns about. Only if you have time — it is a different
product surface and can dilute the recovery story.

---

## What will go wrong, and what to say

**"Your customers are synthetic."**
Agree immediately. *"Yes, and it says so on screen. What is not synthetic is the method: held-out
split, no peeking, all policies at identical volume. `featurise()` consumes `order.created`,
`payment.captured`, `payment.failed`, `coupon.applied` — exactly what Razorpay webhooks emit.
Point it at real data and nothing downstream changes."*

**"Where is the AI?"**
*"The causal model is the AI, and it is the right tool — a language model cannot estimate a
treatment effect. The LLM's job here is explanation, and it is fenced: JavaScript computes the
numbers, a template writes the sentences, the model may only rephrase. Any rewrite that alters a
number is thrown away."*

**"How do we know you did not tune until it passed?"**
*"The first run printed THESIS DOES NOT HOLD. The budget model was wrong — I had sized it at ₹6
per contact and ignored the incentive — so I fixed the model, not the threshold. The harness
still prints that verdict when it fails."*

**"Is this not just A/B testing?"**
*"A/B testing tells you whether an intervention works on average. This tells you which
individuals it works on — and finds the group it makes worse. Those are different questions and
the second one is where the money is."*

---

## Commands, all of them

```bash
npm start                                    # console :8787, meeting :8787/meeting, MCP :8787/mcp
npm run recover                              # the submission
node razorpay/calibration.mjs                # predicted vs delivered
npm test                                     # 42 safety properties
npm run check                                # dependency invariants
npm run bench                                # the thesis on the discount case
npm run build                                # standalone dist/
node --env-file=.env razorpay/recover.mjs --live
node tools/graph.mjs impact engine/core.mjs  # what breaks if you change a file
```

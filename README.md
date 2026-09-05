# Recovery Agent — Razorpay AI Buildathon, Track 03

**A revenue-recovery agent that knows when *not* to spend money.**

It recovered **₹2,32,868 more** than doing nothing, while contacting **65% fewer customers**
than a blanket campaign — and it beat the industry-standard propensity model by **₹2,56,197**,
because that model *loses* money.

```bash
npm install
npm run recover        # the submission — no API keys needed
```

**No API key is required for anything in this repo.** Verified by `npm run demo:check`, which
re-runs the entire demo with all 12 environment variables deleted: **18/18 pass.**

---

## Contents

| | |
| --- | --- |
| [The problem](#the-problem) | why contacting everyone is wrong in two directions |
| [The result](#the-result) | the measured table, and why propensity loses money |
| [The five things Track 03 asks for](#the-five-things-track-03-asks-for) | mapped to evidence |
| [How it works](#how-it-works) | uplift, the two-action decision, the gates |
| [Governance](#governance) | the pacer, the ledger, approval tiers |
| [Explanations you can audit](#explanations-you-can-audit) | cited claims + the validator |
| [Calibration](#calibration) | predicted vs actually delivered |
| [Run it](#run-it) | every command |
| [What is real and what is not](#what-is-real-and-what-is-not) | the exact boundary |
| [Architecture](#architecture) | modules and the enforced dependency graph |
| [API keys](#api-keys) | what each one unlocks, and what breaks without it |
| [A second surface](#a-second-surface-built-on-the-same-engine) | the operator console |

---

## The problem

A payment fails. Every dunning tool does the same thing: **contact everyone.**

That is wrong in two directions at once, and both are ordinary in real payment data.

- **Self-recoverers** retry on their own within a day. A twenty-minute bank outage is not a lost
  customer. Contacting them costs money and recovers nothing that was not already coming back.
- **Dunning-averse customers cancel when chased.** Contacting them has *negative* value — you
  spend money to lose the subscription.

A propensity model — *"who is likely to pay?"* — sees neither. It ranks self-recoverers at the
very top of the contact list, because they *are* the most likely to pay. That is the single most
expensive mistake available, and it is what most tools do.

The right question is not *"who will pay?"* It is **"who pays *because* we acted?"** That
quantity is the **incremental effect**, and it is what this agent estimates:

```
tau(x) = P(recover | contacted, x) − P(recover | left alone, x)
```

Four groups fall out of it, and only one is worth money:

```
                    responds to contact
                    NO              YES
                ┌───────────────┬─────────────────┐
    recovers    │  LOST CAUSE   │  PERSUADABLE    │  <- the only group
    alone: NO   │  don't bother │  CONTACT THESE  │     worth spending on
                ├───────────────┼─────────────────┤
    recovers    │  SURE THING   │  SLEEPING DOG   │  <- contacting these
    alone: YES  │  wasted spend │  ACTIVELY HARMS │     costs you money
                └───────────────┴─────────────────┘
```

---

## The result

**We measured it.** Held-out split, no peeking. Every policy compared at **identical contact
volume**, so a win cannot come from simply spending more.

| Policy | Contacted | Spent | Net margin | vs doing nothing |
| --- | ---: | ---: | ---: | ---: |
| Contact nobody | 0 | ₹0 | ₹9,21,780 | — |
| Everyone, link only | 1,555 | ₹9,330 | ₹11,34,764 | +₹2,12,983 |
| Everyone, link + offer | 1,555 | ₹2,19,964 | ₹10,43,838 | +₹1,22,057 |
| **Propensity** top 552 | 552 | ₹1,20,237 | ₹8,98,452 | **−₹23,329** |
| **This agent** | **552** | ₹76,269 | **₹11,54,648** | **+₹2,32,868** |

**Propensity targeting loses money. It is worse than doing nothing at all.**

Qini coefficient **31.1** on the held-out split (0 = no better than contacting at random).

### It found the behaviour it was never told about

The batch contains four hidden archetypes. **The model never saw these labels** — only payment
history and failure reason.

```
archetype        in batch  contacted  offered   true uplift
nudge_needed          518        80%      73%       +33.0pp   wants to pay, needs the link
hard_fail             383        34%      33%        +5.5pp   card or funds genuinely dead
self_recoverer        431         2%       0%        +2.0pp   retries unprompted within 24h
annoyed               223         0%       0%       −11.5pp   cancels when chased
```

**Zero percent** of the customers who cancel when chased were contacted. **Two percent** of the
self-recoverers. That separation is the whole product.

---

## The five things Track 03 asks for

**1 · Detect revenue at risk**

```
3,109 failed payments in the window, ₹90,71,631 at risk
three_ds_abandoned 590 · insufficient_funds 518 · bank_downtime 511 · session_timeout 463
card_declined 420 · network_error 331 · card_expired 276
```

**2 · Determine the right intervention** — not just *whether* to act, but *what to do*. A payment
link costs ₹6; adding a discount costs a share of the invoice. The agent picks per customer, and
sent an offer to only **505 of 552** contacts. The other 47 got a link alone, because the
discount would have cost more than the extra recovery it bought.

**3 · Execute a bounded workflow** — a budget of **₹78,100** that halts the batch mid-list,
approval tiers (auto `<₹500` · one-click `<₹5,000` · two-person above), and sha256 idempotency
checked against our own ledger *before* any upstream call.

**4 · Measured money recovered across a batch** — the table above, plus calibration: the model
predicts within **2.97pp**, rank correlation **0.916** across all ten deciles.

**5 · Compliant escalation, stopping rules, audit trail** — every decision carries its reasoning
*and the evidence behind every number*, and the run ends with `C7998 DECLINED — budget exhausted
(stopping rule)` rather than quietly overspending.

---

## How it works

```
   events                 features            uplift model          decision
 ─────────────         ──────────────       ───────────────      ─────────────
 order.created         prior orders         CVT single           per customer:
 payment.captured  ->  captured count   ->  classifier       ->  do nothing
 payment.failed        UPI share            targeting tau        send link
 coupon.applied        coupon rate                               link + offer
                       days since last
                       failure reason
                                                  |
                                                  v
                                          ┌───────────────┐
                                          │  GATES        │  budget · tiers
                                          │  idempotency  │  pacer rules
                                          └───────────────┘
                                                  |
                                                  v
                                          cited brief + audit row
```

**The estimator** is a class-variable transformation (Jaskowski & Jaroszewicz): one classifier
that targets uplift directly. We started with a two-model T-learner and replaced it — the
difference of two noisy probabilities was itself so noisy that the ranking was near-useless.

**The two-action decision.** Most tools decide *whether* to contact. Choosing *what to send* is
where the margin is:

```js
const full = tau * amount * MARGIN;                   // the whole prize
const link = { gain: full * LINK_SHARE, cost: 6 };    // link captures 65% of it
const off  = { gain: full,                            // offer captures all of it
               cost: 6 + pTreated * amount * 0.10 };  // but pays for it, on success
// pick the higher expected value; if both are <= 0, do nothing
```

The offer only wins when the customer is *persuadable enough* that the extra 35% of uplift
outweighs the discount. For most of the batch it does not.

---

## Governance

A **pacer** — pure rules, no model calls, each independently testable — watches state that a
prompt cannot see, and refuses to finalise on shaky ground.

```
D1  nudge  an offer whose brief shows no arithmetic
D2  halt   contacting someone whose estimated effect is negative
D3  nudge  |tau| < 0.02 — inside the noise band
D4  halt   expected value <= 0, even when uplift is high
B1  halt   no budget set
B2  halt   spend exceeds budget
B3  nudge  more than 15% of contacts are sure things
B4  halt   even ONE customer contacted who gets worse when chased
B5  halt   Qini <= 0 — do not pretend this is targeting
B6  nudge  zero rejections — a filter that rejects nothing is not a filter
```

On our own run the pacer catches **nothing**, because the earlier gates already did. So we point
the same rules at the propensity list — the one that lost ₹23,329 — and **121 of 552 are halted.**

### The action ledger

Every money action passes through `razorpay/policy.mjs`:

- **Idempotency** — `sha256(caseId, kind, payload)` with stable key-sorted stringify, checked
  against our own ledger **before** the upstream call. A re-run cannot double-charge anyone.
- **Approval tiers** — two-person approval requires two *distinct* approvers, not one person
  clicking twice.
- **Verbatim failure** — a failed adapter call records the **exact upstream error** and keeps a
  **null external reference**. We never synthesise a success. An adapter that returns success
  with nothing to point at is recorded as a **failure**.

States: `proposed → approved → firing → succeeded | failed`. **42 safety properties** cover this
and the pacer (`npm test`).

---

## Explanations you can audit

Every decision produces a brief. **The ordering is the safeguard, and it is the opposite of the
usual one:**

```
1. JavaScript computes the facts and the numbers.        <- arithmetic
2. A deterministic template turns them into sentences.   <- always runs
3. An LLM may REPHRASE those sentences, and nothing else. <- optional
```

The model never sees a number it can change. Any rewrite that drops or alters a figure is
**rejected**, and the deterministic text is used instead.

> **C7747 · CONTACT — link with offer.** Payment of ₹13,243 failed on three ds abandoned, after 3
> attempts. Left alone, this customer recovers **22%** of the time. Contacting them lifts recovery
> to **54%**, an incremental **+32.1pp**. They have completed 7 prior payments, 100% by UPI. They
> have never used a coupon — discounting risks training a full-price customer to wait.

A validator drops any sentence containing a number that is not in the evidence list.
**0 dropped: every sentence traces to evidence.**

---

## Calibration

Ranking correctly is not enough — if you act on a predicted +18pp you need it to *be* +18pp.

```
decile   n     predicted   observed    90% interval
   1    700     +18.6pp     +14.8pp    [ +9.2pp, +20.5pp]
  ...
   9    700      -2.0pp      -3.0pp    [ -8.4pp,  +2.4pp]
  10    700      -5.1pp      -5.6pp    [-11.8pp,  +0.3pp]

usable 10 of 10 · mean abs error 2.97pp · bias 1.41pp · rank corr 0.916
WELL CALIBRATED
```

`MIN_PER_ARM = 30` — the tool **refuses to print a number** for a decile too thin to support one,
rather than showing a confident-looking figure built on eight rows.

---

## Run it

```bash
npm run recover                  # THE SUBMISSION: detect - qualify - decide - govern - measure - audit
node razorpay/calibration.mjs    # predicted vs actually delivered, by decile
npm test                         # 42 safety properties (25 ledger + 17 pacer)
npm run check                    # dependency invariants, 0 errors across 35 modules
npm run demo:check               # the whole runbook with every env var deleted — 18/18
npm run bench                    # the incrementality thesis on the discount case
npm run build                    # standalone dist/ (no server needed)
npm start                        # operator console :8787 · meeting /meeting · MCP /mcp

# optional: only if your test keys authenticate (see .env.example)
node --env-file=.env razorpay/recover.mjs --live
```

Demo runbook: **[DEMO.md](DEMO.md)** · Pitch, one-pager, video script: **[docs/](docs/)**

---

## What is real and what is not

**Real:** the method, the evaluation, and the governance. All of it runs offline —
`npm run recover`, `npm test`, and `npm run check` touch no network and need no keys.

**Real, and precisely this much:** `razorpay/rzp.mjs` is the only payment integration in the
repo — orders, payment links, and HMAC webhook verification with `timingSafeEqual`, written
directly against the REST API with `node:crypto` and no payment SDK. The signature path is
**proven**: 8 cases pass, including a tampered body, a wrong secret, an odd-length hex signature
and non-hex garbage. The HTTP path is **written and correct but unproven** — we have never held a
working Razorpay credential, so no live call in this project has ever returned 200. `--live`
checks the credential first and says so out loud rather than implying otherwise.

**Synthetic:** the customers. Labelled as such in the benchmark header, on screen, and here.
`featurise()` consumes an ordinary event list — `order.created`, `payment.captured`,
`payment.failed`, `coupon.applied` — which is exactly what Razorpay webhooks emit. Point it at
real data and nothing downstream changes.

**We did not tune until it passed.** The first run printed `THESIS DOES NOT HOLD`. The budget
model was wrong — sized per contact while ignoring the incentive, so it bought 6 contacts instead
of 1,555 — and the *model* was fixed, not the threshold. The harness still prints that verdict on
failure.

---

## Architecture

```
razorpay/            the submission
  recover.mjs          the batch run: detect -> qualify -> execute -> measure -> govern -> audit
  uplift.mjs           CVT incremental response model, Qini, four quadrants
  calibration.mjs      predicted vs delivered, by decile, with refusal on thin data
  policy.mjs           action ledger: idempotency, approval tiers, verbatim failure
  pacer.mjs            governance rules — pure, no model calls
  explain.mjs          cited decision briefs + the number validator
  rzp.mjs              Razorpay adapter: orders, links, webhooks, preflight
  twin.mjs  bench.mjs  the benchmark harness
  *.test.mjs           42 safety properties

engine/              the cohort / stage / hazard model the benchmark runs on
  core.mjs             surface-agnostic observation kernel
  surfaces.mjs         six surface packs
  memory.mjs           episodes -> patterns -> timed cues
  library.mjs          measured skill library

server/mcp.mjs       Web MCP server — 18 tools, JSON-RPC 2.0, protocol 2025-06-18
web/                 operator console, live meeting room, floating companion overlay
tools/               dependency graph, bundler, encoding checks, demo-check
docs/                pitch, one-pager, architecture diagram, video script
plan/                design notes for the production build — specification only, no code
```

**Four architectural patterns came from Aegis, our own earlier internal agent framework** —
idempotency checked before the call, verbatim failure, pure governance rules, and cited claims.
All four were reimplemented here from scratch. Nothing from that framework ships in this repo.

### The dependency graph is enforced

`tools/graph.mjs` encodes build invariants, not just documentation:

```bash
npm run check                                  # 0 errors across 35 modules
node tools/graph.mjs impact engine/core.mjs    # what breaks if you change a file
node tools/graph.mjs mermaid                   # render the graph
```

It exists because three bugs previously shipped silently — a module the bundler did not inline,
a duplicate function name across two inlined files, and a script tag pointing at a file that no
longer existed. Each is now a build failure.

---

## API keys

**The submission needs none.** `npm run demo:check` proves it by deleting all 12 variables and
re-running everything: 18/18 pass.

| Variable | Unlocks | Without it |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` + `_SECRET` | `--live` payment links | `--live` aborts cleanly; everything else runs |
| `GROQ_API_KEY` | LLM rephrasing of briefs | template writes them — **numbers identical either way** |
| `STUN_SERVER` / `TURN_*` | meeting across networks | same-machine demo works |
| `RAZORPAY_WEBHOOK_SECRET` | live webhook traffic | signature tests still pass (8/8) |

See **[.env.example](.env.example)**. `.env` is gitignored and has never been committed.

Test keys: Razorpay Dashboard → Settings → API Keys → Generate Test Key. Both halves are shown
once. `recover.mjs` **refuses to run against `rzp_live_` keys** — this batch targets synthetic
customers and must never touch a real account.

---

## A second surface, built on the same engine

The operator console (`npm start`) applies the same observe → dataset → experiment → skill loop
to live sessions: a floating companion overlay, real WebRTC meeting rooms, and cross-session
memory that fires a cue *before* the drop-off it warns about. It shares `engine/` with the
recovery agent and exposes everything over **Web MCP** (18 tools) so an agent can drive all six
surfaces.

It is worth thirty seconds of a demo — but **the Track 03 submission is `npm run recover`.**

---

## Licence

MIT — see [LICENSE](LICENSE).

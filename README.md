# Recovery Agent — Razorpay AI Buildathon, Track 03

**A revenue-recovery agent that knows when *not* to spend money.**

It recovered **₹1,10,811 more** than contacting every failed payment, while contacting
**65% fewer customers**.

```bash
npm install
npm run recover        # the submission — no API keys needed
```

---

## The problem

A payment fails. Every dunning tool does the same thing: contact everyone.

That is wrong in two directions at once, and both are ordinary in real payment data.

- **Self-recoverers** retry on their own within a day. A twenty-minute bank outage is not a lost
  customer. Contacting them costs money and recovers nothing that was not already coming back.
- **Dunning-averse customers cancel when chased.** Contacting them has *negative* value — you
  spend money to lose the subscription.

A propensity model — *"who is likely to pay?"* — sees neither. It ranks self-recoverers at the
very top of the contact list, which is the single most expensive mistake available.

**We measured it.** Held-out split, every policy compared at identical contact volume so a win
cannot come from simply spending more:

| Policy | Contacted | Spent | Net margin | vs doing nothing |
| --- | ---: | ---: | ---: | ---: |
| Contact nobody | 0 | ₹0 | ₹9,21,780 | — |
| Everyone, link only | 1,555 | ₹9,330 | ₹11,34,764 | +₹2,12,983 |
| Everyone, link + offer | 1,555 | ₹2,19,964 | ₹10,43,838 | +₹1,22,057 |
| **Propensity** top 552 | 552 | ₹1,20,237 | ₹8,98,452 | **−₹23,329** |
| **This agent** | **552** | ₹76,269 | **₹11,54,648** | **+₹2,32,868** |

**Propensity targeting loses money.** It is worse than doing nothing at all.

---

## The five things Track 03 asks for

**1 · Detect revenue at risk** — 3,109 failed payments, ₹90,71,631 at risk, by failure reason.

**2 · Determine the right intervention** — not just *whether* to act. A payment link costs ₹6;
adding a discount costs hundreds. The agent chooses per customer and sent offers to only
**505 of 552**.

**3 · Execute a bounded workflow** — a budget that halts the batch mid-list, approval tiers
(auto <₹500 · one-click <₹5,000 · two-person above), and sha256 idempotency checked against our
own ledger *before* any upstream call.

**4 · Measured money across a batch** — the table above. Plus calibration: the model predicts
within **2.97pp**, rank correlation **0.916**.

**5 · Compliant escalation, stopping rules, audit trail** — every decision carries its reasoning
*and the evidence behind every number*.

> **C7747 · CONTACT — link with offer.** Payment of ₹13,243 failed on three ds abandoned, after 3
> attempts. Left alone, this customer recovers **22%** of the time. Contacting them lifts recovery
> to **54%**, an incremental **+32.1pp**. They have completed 7 prior payments, 100% by UPI. They
> have never used a coupon — discounting risks training a full-price customer to wait.

A validator drops any sentence containing a number that is not in the evidence list.
**0 dropped: every sentence traces to evidence.**

---

## It found the behaviour it was never told about

```
archetype        in batch  contacted  offered   true uplift
nudge_needed          518        80%      73%       +33.0pp   wants to pay, needs the link
hard_fail             383        34%      33%        +5.5pp   card or funds genuinely dead
self_recoverer        431         2%       0%        +2.0pp   retries unprompted within 24h
annoyed               223         0%       0%       -11.5pp   cancels when chased
```

**Zero percent** of the customers who cancel when chased were contacted. The model saw only
payment history and failure reason — never these labels.

---

## Governance

A **pacer** — pure rules, no model calls, individually testable — watches state a prompt cannot
see and refuses to finalise on shaky ground.

```
D1  nudge  an offer whose brief shows no arithmetic
D2  halt   contacting someone whose estimated effect is negative
D4  halt   expected value <= 0, even when uplift is high
B4  halt   even ONE customer contacted who gets worse when chased
B5  halt   Qini <= 0 — do not pretend this is targeting
```

On our own run it catches nothing, because the earlier gates already did. Pointed at the
propensity list — the one that lost ₹23,329 — **121 of 552 would be halted.**

Every money action: a failed adapter call records the **verbatim upstream error** and keeps a
**null external reference**. We never synthesise a success. An adapter returning success with
nothing to point at is recorded as a failure.

---

## Run it

```bash
npm run recover                  # detect - qualify - decide - govern - execute - measure - audit
node razorpay/calibration.mjs    # predicted vs actually delivered, by decile
npm test                         # 42 safety properties (25 policy + 17 pacer)
npm run check                    # dependency invariants, 0 errors across 34 modules
npm start                        # operator console :8787 · meeting room /meeting · MCP /mcp

# optional: only if your test keys authenticate (see .env.example)
node --env-file=.env razorpay/recover.mjs --live
```

---

## What is real and what is not

**Real:** the method, the evaluation, and the governance. All of it runs offline —
`npm run recover`, `npm test`, and `npm run check` touch no network and need no keys.

**Real, and precisely this much:** `razorpay/rzp.mjs` is the only payment integration
in the repo — orders, payment links, and HMAC webhook verification with
`timingSafeEqual`, written directly against the REST API with `node:crypto` and no
payment SDK. The signature path is **proven**: 8 cases pass, including a tampered
body, a wrong secret, and non-hex garbage. The HTTP path is **written and correct
but unproven** — we have never held a working Razorpay credential, so no live call
in this project has ever returned 200. `--live` now checks the credential first and
says so out loud rather than implying otherwise.

**Synthetic:** the customers. Labelled as such in the benchmark header, on screen,
and here. `featurise()` consumes an ordinary event list — `order.created`,
`payment.captured`, `payment.failed`, `coupon.applied` — which is exactly what
Razorpay webhooks emit. Point it at real data and nothing downstream changes.

**We did not tune until it passed.** The first run printed `THESIS DOES NOT HOLD`.
The budget model was wrong — sized per contact while ignoring the incentive — so the
model was fixed, not the threshold. The harness still prints that verdict on failure.

---

## Layout

```
razorpay/          the submission
  recover.mjs        the batch run
  uplift.mjs         incremental response model, Qini, quadrants
  calibration.mjs    predicted vs delivered
  policy.mjs         action ledger: idempotency, approval tiers, audit
  pacer.mjs          governance rules
  explain.mjs        cited decision briefs
  rzp.mjs            Razorpay test-mode adapter
  *.test.mjs         42 safety properties

docs/              pitch, architecture diagram, video script
web/  server/      operator console, live meeting room, Web MCP server (18 tools)
engine/            the cohort / stage / hazard model the benchmark runs on
tools/             dependency graph, build invariants, encoding checks
plan/              design notes for the production build — specification only, no code
```

Demo runbook: **[DEMO.md](DEMO.md)** · Pitch and video script: **[docs/](docs/)**

---

## A second surface, built on the same engine

The operator console (`npm start`) applies the same observe → dataset → experiment → skill loop
to live meetings: a floating companion overlay, real WebRTC rooms, and cross-session memory that
fires a cue *before* the drop-off it warns about. It shares `engine/` with the recovery agent and
is worth thirty seconds of a demo — but the Track 03 submission is `npm run recover`.

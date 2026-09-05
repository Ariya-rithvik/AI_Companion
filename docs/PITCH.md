# Backstage Recovery — Track 03 submission

> **A recovery agent that knows when *not* to spend money.**
> It recovered ₹1,10,811 more than contacting everyone, while contacting 65% fewer customers.

Every figure below is reproducible from this repo. The command is printed next to it.

---

## The problem

A payment fails. Every dunning tool on the market does the same thing: contact everyone.

That is wrong in two directions at once, and both are ordinary in real payment data.

- **Self-recoverers** retry on their own within a day. A 20-minute bank outage is not a lost
  customer. Contacting them costs money and recovers nothing that was not already coming.
- **Dunning-averse customers cancel when chased.** Contacting them has *negative* value: you
  spend money to lose the subscription.

A propensity model — "who is likely to pay?" — cannot see either. It ranks self-recoverers at
the very top of the contact list, which is the single most expensive mistake available.

**We measured that.** `npm run recover`

| Policy | Contacted | Spent | Net margin | vs doing nothing |
| --- | ---: | ---: | ---: | ---: |
| Contact nobody | 0 | ₹0 | ₹9,21,780 | — |
| Everyone, link only | 1,555 | ₹9,330 | ₹11,34,764 | +₹2,12,983 |
| Everyone, link + offer | 1,555 | ₹2,19,964 | ₹10,43,838 | +₹1,22,057 |
| **Propensity** top 552 | 552 | ₹1,20,237 | ₹8,98,452 | **−₹23,329** |
| **Ours (gated)** | **552** | ₹76,269 | **₹11,54,648** | **+₹2,32,868** |

Propensity targeting **loses money** — worse than doing nothing at all.

---

## The five things Track 03 asks for

### 1 · Detect revenue at risk
3,109 failed payments in the window, **₹90,71,631 at risk**, grouped by failure reason.

### 2 · Determine the right intervention
Not *whether* to act — *what* to do. A payment link costs ₹6; adding a discount costs hundreds.
The agent chooses per customer, and sent offers to only **505 of 552**.

The model estimates **incremental** response — `P(recover | contacted) − P(recover | not)` —
using class-variable transformation over a prior randomised recovery test.
**Qini 31.1** on a held-out split.

### 3 · Execute a bounded recovery workflow
- **Budget** ₹78,100, a hard stop that halts the batch mid-list
- **Approval tiers** — auto <₹500 · one-click <₹5,000 · two-person above
- **Idempotency** — `sha256([case, kind, payload])`, checked against our own ledger *before* any
  upstream call, because a payment-link create has no upstream idempotency
- **Two-person means two distinct people** — the same approver twice is rejected

`npm test` → **25 passed, 0 failed**

### 4 · Show measured money recovered across a batch
The table above. Held-out split, no peeking, all policies compared at identical volume so a win
cannot come from spending more.

**And the model is calibrated, not just correctly ordered.** `node razorpay/calibration.mjs`

| | |
| --- | --- |
| mean absolute error | **2.97pp** |
| bias | +1.41pp (slight over-promise, stated) |
| rank correlation | **0.916** |
| verdict | **well calibrated** |

Decile 1 predicted +18.6pp and delivered +14.8pp. Decile 10 predicted −5.1pp and delivered
−5.6pp — it finds the group that gets *worse* when contacted.

### 5 · Compliant escalation, stopping rules, audit trail
Every decision carries its reasoning **and the evidence behind every number**:

> **C7747 · CONTACT — link with offer.** Payment of ₹13,243 failed on three ds abandoned, after
> 3 attempts. Left alone, this customer recovers **22%** of the time. Contacting them lifts
> recovery to **54%**, an incremental **+32.1pp**. They have completed 7 prior payments, 100% by
> UPI. They have never used a coupon — discounting risks training a full-price customer to wait.

A validator drops any sentence containing a number that is not in the evidence list.
Currently **0 dropped: every sentence traces to evidence.**

---

## The governance layer

A **pacer** — pure rules, no model calls, individually testable — watches state the prompt
cannot see and refuses to finalise on shaky ground.

```
D1  nudge  an offer whose brief shows no arithmetic
D2  halt   contacting someone whose estimated effect is negative
D4  halt   expected value <= 0, even when uplift is high
B4  halt   even ONE customer contacted who gets worse when chased
B5  halt   Qini <= 0 — "do not pretend this is targeting"
```

`npm test` → **17 passed, 0 failed**

On our own run the pacer catches **nothing** — the earlier gates already did. So we point the
same rules at the propensity list, the one that lost ₹23,329:

```
121 of 552 would have been halted
  HALT C3923  Estimated effect is -0.3pp — contacting this customer is
              expected to REDUCE recovery. Refusing.
```

That is the loss, itemised.

---

## One failure handled gracefully

Kill the server mid-request and the room-create button does not hang:

> **"Could not create the room: websocket error. Is the server running?"** — in red, button
> re-enabled, socket closed.

Every money action goes through the same discipline: a failed adapter call records the
**verbatim upstream error** and keeps a **null external reference**. We never synthesise a
success ref. An adapter that returns success with nothing to point at is recorded as a failure.

---

## What is real and what is not

**Real:** the method, the evaluation, and the governance. All of it runs offline — no key,
no network.

**Real, and precisely this much:** `razorpay/rzp.mjs` is the only payment integration in the
repo — orders, payment links, and HMAC webhook verification with `timingSafeEqual`, written
against the REST API with `node:crypto` and no payment SDK. The signature path is **proven**:
8/8 cases including a tampered body and a wrong secret. The HTTP path is **written and correct
but unproven** — we have never held a working Razorpay credential, so no live call in this
project has returned 200. `--live` preflights the credential and says so rather than implying
otherwise.

**Synthetic:** the customers. Labelled as such in the benchmark header, in the README, and on
screen. `featurise()` consumes an ordinary event list — `order.created`, `payment.captured`,
`payment.failed`, `coupon.applied` — which is exactly what Razorpay webhooks emit. Point it at
real data and nothing downstream changes.

We did not tune until it passed. The first run printed **"THESIS DOES NOT HOLD"** and we fixed
the budget model rather than the threshold.

---

## Reproduce everything

```bash
npm run recover                  # the batch: detect -> qualify -> execute -> measure -> audit
node razorpay/calibration.mjs    # predicted vs actually delivered, by decile
npm test                         # 42 safety properties
npm run check                    # dependency invariants, 0 errors across 34 modules
npm run bench                    # the incrementality thesis on the discount case
node --env-file=.env razorpay/recover.mjs --live   # optional; aborts unless keys authenticate
```

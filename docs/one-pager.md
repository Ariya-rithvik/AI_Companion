# Recovery Agent — One-Page Summary

**Razorpay AI Buildathon · Track 03 — AI Revenue Recovery**

> A revenue-recovery agent that knows when *not* to spend money.

---

## The key result

A payment fails. Every dunning tool does the same thing: contact everyone. That is wrong in
two directions at once, and both are ordinary in real payment data — **self-recoverers** retry
on their own within a day, and **dunning-averse customers cancel when chased**.

A propensity model — *"who is likely to pay?"* — sees neither. It ranks self-recoverers at the
top of the contact list, which is the single most expensive mistake available.

Held-out split, every policy compared at identical contact volume so a win cannot come from
simply spending more:

| Policy | Contacted | Spent | Net margin | vs doing nothing |
| --- | ---: | ---: | ---: | ---: |
| Contact nobody | 0 | ₹0 | ₹9,21,780 | — |
| Everyone, link only | 1,555 | ₹9,330 | ₹11,34,764 | +₹2,12,983 |
| Everyone, link + offer | 1,555 | ₹2,19,964 | ₹10,43,838 | +₹1,22,057 |
| **Propensity** top 552 | 552 | ₹1,20,237 | ₹8,98,452 | **−₹23,329** |
| **This agent** | **552** | ₹76,269 | **₹11,54,648** | **+₹2,32,868** |

**Propensity targeting loses money — it is worse than doing nothing.** Only incrementality
flips the sign.

> Reproduced with `npm run recover`. No API key, no network.

---

## It found the behaviour it was never told about

```
archetype        in batch  contacted  offered   true uplift
nudge_needed          518        80%      73%       +33.0pp   wants to pay, needs the link
hard_fail             383        34%      33%        +5.5pp   card or funds genuinely dead
self_recoverer        431         2%       0%        +2.0pp   retries unprompted within 24h
annoyed               223         0%       0%      −11.5pp    cancels when chased
```

**Zero percent** of the customers who cancel when chased were contacted. The model saw only
payment history and failure reason — never these labels.

---

## What is built

| Component | Where | Evidence |
|---|---|---|
| **Incrementality engine** — CVT uplift, Qini, four quadrants, gated policy | `razorpay/uplift.mjs` | `npm run recover` |
| **Calibration** — predicted vs delivered, by decile | `razorpay/calibration.mjs` | 2.97pp mean error, 0.916 rank corr |
| **Action ledger** — sha256 idempotency, approval tiers, audit trail | `razorpay/policy.mjs` | 25 safety properties |
| **Pacer** — pure governance rules that halt on shaky ground | `razorpay/pacer.mjs` | 17 safety properties |
| **Cited briefs** — every number traces to evidence or is dropped | `razorpay/explain.mjs` | 0 claims dropped |
| **Razorpay adapter** — orders, links, HMAC webhooks | `razorpay/rzp.mjs` | 8/8 signature cases |
| **Operator console + meeting room** — second surface, same engine | `web/` | `npm start` |
| **Web MCP server** — 18 tools, JSON-RPC 2.0 | `server/mcp.mjs` | `POST /mcp` |
| **Code knowledge graph** — impact analysis + build invariants | `tools/graph.mjs` | `npm run check` |

**34 modules · 0 errors · 42 safety properties · 18/18 demo steps pass with zero API keys.**

---

## Governance

A pacer — pure rules, no model calls, individually testable — watches state a prompt cannot see:

```
D2  halt   contacting someone whose estimated effect is negative
D4  halt   expected value <= 0, even when uplift is high
B4  halt   even ONE customer contacted who gets worse when chased
B5  halt   Qini <= 0 — do not pretend this is targeting
```

On our run it catches nothing, because the earlier gates already did. Pointed at the propensity
list — the one that lost ₹23,329 — **121 of 552 would be halted.**

A failed adapter call records the **verbatim upstream error** and keeps a **null external
reference**. We never synthesise a success.

---

## What is real and what is not

**Real:** the method, the evaluation, and the governance. Every command below runs offline.

**Real, and precisely this much:** `razorpay/rzp.mjs` is the only payment integration in the
repo, written against the REST API with `node:crypto` and no payment SDK. The signature path is
**proven** — 8/8 cases including a tampered body and a wrong secret. The HTTP path is **written
and correct but unproven**: we have never held a working Razorpay credential, so no live call in
this project has returned 200. `--live` preflights and says so.

**Synthetic:** the customers. Labelled as such in the benchmark header, on screen, and here.
`featurise()` consumes an ordinary event list — `order.created`, `payment.captured`,
`payment.failed`, `coupon.applied` — exactly what Razorpay webhooks emit. Point it at real data
and nothing downstream changes.

**We did not tune until it passed.** The first run printed `THESIS DOES NOT HOLD`. The budget
model was wrong — sized per contact while ignoring the incentive — so the model was fixed, not
the threshold. The harness still prints that verdict on failure.

---

## Run it

```bash
npm run recover      # the submission — no API keys needed
npm test             # 42 safety properties
npm run demo:check   # every demo step, all env vars deleted
npm start            # console + meeting room on :8787
```

Architecture: `node tools/graph.mjs mermaid` or see `docs/architecture.svg`.

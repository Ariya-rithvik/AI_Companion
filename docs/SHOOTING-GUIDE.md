# Shooting guide — 8 clips, 5 minutes

Every clip: **the exact command**, **what is on screen**, **what you say**, **what you do with
the cursor**. Record each clip separately and cut them together — one continuous take will make
you rush the two moments that matter.

---

## Setup — 10 minutes before you press record

```bash
npm run demo:check
```

**18/18 or do not record.** If anything fails, fix it first — this is the whole runbook.

```bash
npm run recover        # let it finish completely
```

Then **scroll up to the MEASURE table and leave it there.** Nobody watches it compute.

| Setting | Value |
| --- | --- |
| Terminal font | 16–18pt. Bigger than feels right — it will be watched on a laptop |
| Terminal width | wide enough that the MEASURE table does not wrap. Test it |
| Theme | dark |
| Notifications | off. Slack, email, everything |
| Browser tabs | close all but the one you need |

**The one rule: never read a number off a slide.** Every figure you say is on screen from a
command that just ran. That is the whole credibility of the video.

---

## Clip 1 — The hook  `0:00–0:35`

**Screen:** `npm run recover`, scrolled to MEASURE.

```
POLICY                   CONTACTED  RECOVERED  OFFERS      SPENT   NET MARGIN  VS NOTHING
Contact nobody                   0        496       0         ₹0    ₹9,21,780         +₹0
Everyone, link only           1555        618       0     ₹9,330   ₹11,34,764  +₹2,12,983
Everyone, link + offer        1555        684    1555  ₹2,19,964   ₹10,43,838  +₹1,22,057
Propensity top 552             552        545     552  ₹1,20,237    ₹8,98,452    ₹-23,329
Uplift top 552                 552        661     552    ₹74,886   ₹11,27,737  +₹2,05,957
Policy engine (gated)          552        645     505    ₹76,269   ₹11,54,648  +₹2,32,868
```

**Say:**

> "A payment fails. Every dunning tool does the same thing — contact everyone.
>
> We measured what that costs. Three thousand one hundred failed payments. Ninety lakh rupees
> at risk.
>
> Now target it the way every marketing tool targets — rank customers by who's most likely to
> pay."

**Cursor:** move to the `Propensity` row. Stop moving.

> "**Minus twenty-three thousand rupees. It loses money. It is worse than doing nothing at all.**"

**Then be silent for two full seconds.** This is the moment the whole video exists for. Do not
talk over it.

---

## Clip 2 — Why  `0:35–1:20`

**Screen:** same table, then scroll up to DETECT.

```
3109 failed payments in the window, ₹90,71,631 at risk
three_ds_abandoned 590 · insufficient_funds 518 · bank_downtime 511 · session_timeout 463 ...
```

**Say:**

> "Because 'likely to pay' is the wrong question.
>
> Look at bank downtime — five hundred and eleven customers. A twenty-minute outage. They retry
> tonight on their own, seventy percent of the time. They are the **most likely people in the
> batch to recover** — so a propensity model ranks them first. Contacting them costs money and
> changes nothing.
>
> And there's a group that's worse. Customers who **cancel when you chase them.** Contacting
> them has negative value — you spend money to lose the subscription.
>
> The right question isn't 'will they pay'. It's 'will they pay **because we acted**'."

---

## Clip 3 — What it found  `1:20–2:10`

**Screen:** scroll to the archetype table.

```
archetype        in batch  contacted  offered   true uplift
nudge_needed          518        80%      73%       +33.0pp
hard_fail             383        34%      33%        +5.5pp
self_recoverer        431         2%       0%        +2.0pp
annoyed               223         0%       0%       -11.5pp
```

**Say:**

> "The model was **never told these labels.** It found them from payment history and failure
> reason alone."

**Cursor:** down the `contacted` column, row by row, as you say each number.

> "Eighty percent of the people who genuinely needed a nudge. Two percent of the self-recoverers.
> And —"

**Cursor:** stop on the `annoyed` row.

> "— **zero percent** of the people who cancel when chased."

**Pause. Two seconds.** This is the second moment. Then scroll to the summary:

```
vs doing nothing          +₹2,32,868   the headline number
vs propensity targeting   +₹2,56,196   that policy is underwater by ₹23,329
vs blanket link only        +₹19,884   strongest baseline, at 65% fewer contacts
```

> "Two lakh thirty-two thousand rupees against doing nothing. Two lakh fifty-six against the
> propensity model teams actually ship — because that one is underwater."

**Do not skip the third line.** Leaving it on screen is what makes the first two believable.

---

## Clip 4 — Calibrated, not lucky  `2:10–2:50`

**Command:**

```bash
node razorpay/calibration.mjs
```

**Say:**

> "Ranking correctly isn't enough. If it says plus thirty and delivers plus eight, you sized your
> budget against a number nobody should have trusted."

**Cursor:** decile 1, then decile 10.

> "Held-out customers. Decile one: predicted plus eighteen point six, delivered plus fourteen
> point eight. Decile ten: predicted minus five, delivered minus five point six — it correctly
> finds the group that gets **worse**.
>
> Mean absolute error under three points. Rank correlation nought point nine two. And where a
> decile is too thin to be honest, it **refuses to print a number** and says why."

---

## Clip 5 — Bounded and gated  `2:50–3:40`

**Screen:** scroll to GOVERNANCE.

```
5 · GOVERNANCE
    pacer      0 halted · 0 nudged · rules fired: none — earlier gates caught everything
    same rules on the PROPENSITY list (the one that lost money): 121 would have been halted
      would HALT C3923  Estimated effect is -0.3pp — contacting this customer is expected
                        to REDUCE recovery. Refusing.
    batch      PROCEED — all invariants hold
    ledger     0 skipped · awaiting approval: two-person 106 · one-click 446
```

**Say:**

> "Every money action is bounded and gated. A budget that halts the batch mid-list. Approval
> tiers — under five hundred automatic, above five thousand needs **two distinct people**, and
> the same approver twice is rejected. Idempotency: a hash of the case and payload, checked
> against our own ledger **before** any upstream call, so a re-run cannot double-charge anyone.
>
> And a **pacer** — pure rules, no model in the loop."

**Cursor:** the `0 halted` line.

> "On our run it catches nothing, because the earlier gates already did. So we point the same
> rules at the propensity list — the one that lost money."

**Cursor:** the `121 would have been halted` line.

> "**One hundred and twenty-one of five hundred and fifty-two.** That's the loss, itemised, by
> rules that don't need a model to run."

---

## Clip 6 — Every claim cites evidence  `3:40–4:20`

**Screen:** scroll to the C7747 brief.

```
C7747  CONTACT — link with offer
    Payment of ₹13,243 failed on three ds abandoned, after 3 attempt(s).
    Left alone, this customer recovers 22% of the time. Contacting them
    lifts recovery to 54%, an incremental +32.1pp. They have completed 7
    prior payments, 100% of them by UPI. They have never used a coupon.
    Discounting risks training a full-price customer to wait.
```

**Say:**

> "This is what the operator approving thirteen thousand rupees actually sees. Not 'blocked' —
> the whole reasoning, and every number traces to a record.
>
> A validator drops any sentence containing a figure that isn't in the evidence list. Right now:
> **zero dropped.**
>
> And the ordering matters. JavaScript computes the numbers. A template writes the sentences. A
> language model may only **rephrase**. Any rewrite that alters a number is thrown away — the
> model never touches a figure."

---

## Clip 7 — It reproduces  `4:20–4:40`

**Do NOT film `--live`** unless you have already run it and watched three `OK` lines with
`rzp.io` URLs appear. With no working keys it prints `LIVE ABORTED` — a safe outcome, but not
one to discover on camera.

**Commands:**

```bash
npm test
npm run demo:check
```

**Say, over `rzp.mjs` on screen:**

> "The Razorpay adapter is written directly against the REST API — no SDK, no payment dependency
> at all. Orders, payment links, HMAC webhook verification with constant-time comparison. Eight
> signature cases pass, including a tampered body and a wrong secret.
>
> Forty-two safety properties in total. And the entire demo re-run with **every environment
> variable deleted** — eighteen of eighteen.
>
> **Everything you just watched needs no credential to reproduce.**"

That last sentence is a stronger claim than a payment link, and unlike a payment link, it is one
you can stand behind.

---

## Clip 8 — Close  `4:40–5:00`

**Screen:** the MEASURE table again.

**Say:**

> "Observation, a labelled dataset, a calibrated causal model, a governed executor, and a measured
> result on a held-out batch.
>
> The customers here are synthetic and we say so on screen. The pipeline is not — `featurise`
> consumes exactly what Razorpay webhooks emit. Order created, payment captured, payment failed,
> coupon applied. Point it at real data and nothing downstream changes.
>
> The first time we ran this, it printed **'thesis does not hold'**. We fixed the model, not the
> threshold. The harness still prints that verdict when it fails."

---

## The question you must not be surprised by

**"Why not just send everyone a payment link? Your own table says that makes ₹11,34,764."**

This is the sharpest question available and the third summary line puts it on screen yourself.
That is deliberate — you want to be the one who raises it.

> "It's a strong baseline, and I'd rather show it than hide it. Three things.
>
> One — we beat it while contacting **sixty-five percent fewer people**. That gap is inbox
> fatigue and unsubscribes, which this batch doesn't price and a real business does.
>
> Two — blanket link contacts all two hundred and twenty-three customers who cancel when chased.
> We contact zero. That cost compounds across batches; ours doesn't.
>
> Three — the comparison that matters is against what teams **actually ship**, and that's the
> propensity model. It's underwater by twenty-three thousand."

## Two more you will get

**"Your customers are synthetic."**

> "Yes, and it says so on screen. What isn't synthetic is the method — held-out split, no peeking,
> every policy at identical contact volume so a win can't come from spending more."

**"Where is the AI?"**

> "The causal model is the AI, and it's the right tool — a language model cannot estimate a
> treatment effect. The LLM's job is explanation, and it's fenced so it cannot touch a number."

---

## Final checklist

- [ ] `npm run demo:check` → 18/18
- [ ] `npm run recover` finished, scrolled to MEASURE
- [ ] font 16pt+, table not wrapping, notifications off
- [ ] two-second silence after **"minus twenty-three thousand"** (clip 1)
- [ ] two-second silence after **"zero percent"** (clip 3)
- [ ] the blanket-link answer rehearsed out loud once
- [ ] no slide anywhere in the video
- [ ] `--live` cut unless you saw three `OK` lines
- [ ] under 5:00 — cut the console/meeting segment if you overrun

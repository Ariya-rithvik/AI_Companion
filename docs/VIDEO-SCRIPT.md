# 5-minute video script

**Rule for the whole script: open on the measured result, not the architecture.** Judges have
watched forty architecture diagrams by the time they reach yours. Nobody has shown them a
targeting strategy that loses money.

---

## First: what do you actually film — the simulation or the real thing?

**You film real terminal output. Every time. Nothing is staged, nothing is a slide.**

The distinction that matters is not "simulated vs real" — it is **which part** is simulated:

| | | |
| --- | --- | --- |
| **The customers** | synthetic | 9,000 generated actors. Say so on camera. |
| **Everything else** | **real** | the model trains, the split is held out, the money is computed, the gates fire, the tests run |

So when you run `npm run recover` on camera, that is **not a playback of a recorded result** —
the model is being fitted and evaluated live, on data it has not seen. The number that appears is
computed while you watch. That is the honest and the strongest thing you can show.

**Never do these:**

- ❌ read numbers off a slide — run the command
- ❌ film `--live` unless you have watched three `OK` lines appear (see 4:20)
- ❌ claim live Razorpay calls have been made — **none ever have**
- ❌ re-shoot until you get a good number — the split is fixed, the number is the number

**Before you press record:**

```bash
npm run demo:check      # 18/18 must pass — this is the whole runbook, no keys
npm run recover         # let it finish, then scroll UP to the MEASURE table
```

Have the recover output **already on screen and pre-scrolled**. Do not make anyone watch it
compute. Terminal at ~16pt, dark theme, window wide enough that the MEASURE table does not wrap.

---

## 0:00 – 0:35 · The hook

> "A payment fails. Every dunning tool does the same thing — contact everyone.
>
> We measured what that costs. Three thousand one hundred failed payments, ninety lakh rupees
> at risk."

**Screen:** `npm run recover`, scrolled to the MEASURE table.

> "Now target it the way every marketing tool targets — rank customers by who's most likely to
> pay."

*(point at the propensity row)*

> "**Minus twenty-three thousand rupees. It loses money. It is worse than doing nothing at all.**"

**Pause here. Let it sit.** This is the moment the video is built around.

---

## 0:35 – 1:20 · Why

> "Because 'likely to pay' is the wrong question.
>
> This customer" *(point at a bank_downtime row)* "had a twenty-minute bank outage. He retries
> tonight on his own, seventy percent of the time. He is the single most likely person in the
> batch to recover — so a propensity model ranks him **first**. Contacting him costs money and
> changes nothing.
>
> And these two hundred and twenty-three" *(point at the archetype table)* "**cancel when you
> chase them.** Contacting them has negative value — you spend money to lose the customer.
>
> The right question isn't 'will they pay'. It's 'will they pay **because we acted**'."

---

## 1:20 – 2:10 · The result

**Screen:** the archetype table.

```
archetype        in batch  contacted  offered   true uplift
nudge_needed          518        80%      73%       +33.0pp
hard_fail             383        34%      33%        +5.5pp
self_recoverer        431         2%       0%        +2.0pp
annoyed               223         0%       0%       -11.5pp
```

> "The model was **never told these labels.** It found them from payment history and failure
> reason alone.
>
> Eighty percent of the people who genuinely needed a nudge. Two percent of the self-recoverers.
> And **zero percent** of the people who cancel when chased."

**Slow down for that last line.**

> "Against doing nothing, that's **two lakh thirty-two thousand rupees** recovered. Against the
> propensity model everyone actually ships — **two lakh fifty-six thousand**, because that one
> is underwater."

---

## 2:10 – 2:50 · It's calibrated, not just lucky

> "Ranking correctly isn't enough. If it says plus thirty and delivers plus eight, you sized your
> budget against a number nobody should have trusted."

**Screen:** `node razorpay/calibration.mjs`

> "Held-out customers. Decile one: predicted +18.6, delivered +14.8. Decile ten: predicted minus
> five point one, delivered minus five point six — it correctly finds the group that gets
> *worse*.
>
> Mean absolute error under three percentage points, rank correlation 0.92. And where a decile is
> too thin to be honest, it **refuses to print a number** and says why."

---

## 2:50 – 3:40 · Bounded, gated, auditable

**Screen:** the GOVERNANCE and AUDIT sections.

> "Every money action is bounded and gated. Budget: a hard stop that halts the batch mid-list.
> Approval tiers: under five hundred is automatic, above five thousand needs **two distinct
> people** — the same approver twice is rejected. Idempotency: a hash of the case and payload,
> checked against our own ledger **before** any upstream call, so a re-run cannot double-charge
> anyone.
>
> And a **pacer** — pure rules, no model in the loop — that refuses to finalise on shaky ground."

*(scroll to the pacer line)*

> "On our run it catches nothing, because the earlier gates already did. So we point the same
> rules at the propensity list — the one that lost money.
>
> **One hundred and twenty-one of five hundred and fifty-two would be halted.** That's the loss,
> itemised."

---

## 3:40 – 4:20 · Every claim cites its evidence

**Screen:** one brief (C7747).

> "This is what the operator approving thirteen thousand rupees actually sees. Not 'blocked' —
> the whole reasoning, and every number in it traces to a record.
>
> A validator drops any sentence containing a figure that isn't in the evidence list. Right now:
> **zero dropped.**
>
> And the ordering matters — JavaScript computes the numbers, a template writes the sentences,
> and a language model may only *rephrase*. Any rewrite that alters a number is thrown away.
> **The model never touches a figure.**"

---

## 4:20 – 4:40 · The integration, stated exactly

**Do not film `--live` unless you have run it beforehand and watched three `OK` lines with
`rzp.io` URLs appear.** With placeholder or missing keys it prints `LIVE ABORTED`. That is a safe
outcome, not a crash — but it is not something to discover on camera.

**If you do not have working test keys — the default — cut this scene and say this instead,
over the `rzp.mjs` source:**

> "The Razorpay adapter is written directly against the REST API — no SDK, no payment dependency
> at all. Orders, payment links, and HMAC webhook verification with constant-time comparison.
> Eight signature cases pass, including a tampered body and a wrong secret.
>
> What you just watched needs no network and no key at all."

**Screen instead:** `npm test` → `42 passed`, and `npm run demo:check` → `18/18`.

> "Forty-two safety properties. And the whole demo re-run with every environment variable
> deleted — eighteen of eighteen. **This needs no credential to reproduce.**"

That is a stronger claim than a payment link, and it is one you can actually stand behind.

---

## 4:40 – 5:00 · Close

> "Observation, a labelled dataset, a calibrated causal model, a governed executor, and a measured
> result on a held-out batch.
>
> The customers here are synthetic and we say so on screen. The pipeline is not — `featurise`
> consumes exactly what Razorpay webhooks emit: order created, payment captured, payment failed,
> coupon applied. Point it at real data and nothing downstream changes.
>
> The first time we ran this, it printed **'thesis does not hold'**. We fixed the model, not the
> threshold. The harness still prints that verdict when it fails."

---

## The three questions you will be asked

**1 · "Why not just send everyone a payment link? Your own table says that makes ₹11,34,764."**

This is the sharpest question available and you must not be surprised by it. Blanket link-only
**is** a strong baseline here — the agent beats it by ₹19,884, not by lakhs.

> "It is a strong baseline, and I'd rather point at that than hide it. Three things. One, we beat
> it while contacting **sixty-five percent fewer people** — that gap is inbox fatigue and
> unsubscribes that this batch doesn't price. Two, blanket link contacts all two hundred and
> twenty-three customers who cancel when chased; we contact zero, and that cost compounds across
> batches while ours doesn't. Three, the comparison that actually matters is against what teams
> **ship** — and that's the propensity model, which is underwater by twenty-three thousand."

**2 · "Your customers are synthetic."**

> "Yes, and it says so on screen. What is not synthetic is the method: held-out split, no peeking,
> all policies at identical contact volume so a win can't come from spending more. `featurise()`
> consumes exactly what Razorpay webhooks emit."

**3 · "Where is the AI?"**

> "The causal model is the AI, and it's the right tool — a language model cannot estimate a
> treatment effect. The LLM's job here is explanation, and it's fenced: JavaScript computes the
> numbers, a template writes the sentences, the model may only rephrase. Any rewrite that alters
> a number is thrown away."

---

## Notes for the recording

- **Do not** show the architecture diagram before 3:00. It's context, not the point.
- Run the commands live. A terminal that actually executes beats any slide.
- The two moments that land: **propensity loses money** (0:30) and **0% of the cancel-when-chased
  group** (1:50). Slow down for both, and pause after each.
- Have `npm run recover` pre-scrolled to MEASURE. Nobody should watch it compute.
- If the port is busy, `PORT=8788 npm start`. The server names the problem now instead of
  printing a stack trace.
- Total runtime target 5:00. If you overrun, cut the console/meeting segment entirely — it is a
  different product surface and it dilutes the recovery story.

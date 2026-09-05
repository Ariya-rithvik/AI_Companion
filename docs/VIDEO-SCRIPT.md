# 5-minute video script

**Rule for the whole script: open on the measured result, not the architecture.** Judges have
watched forty architecture diagrams by the time they reach yours. Nobody has shown them a
targeting strategy that loses money.

Every number below is on screen from a real command. Do not read numbers off a slide — run it.

---

## 0:00 – 0:35 · The hook

> "A payment fails. Every dunning tool does the same thing — contact everyone.
>
> We measured what that costs. This is a batch of three thousand one hundred failed payments,
> ninety lakh rupees at risk."

**Screen:** `npm run recover`, scrolled to the MEASURE table.

> "Contact everyone with an offer: you make ₹1,22,000 over doing nothing.
>
> Now target it the way every marketing tool targets — rank by who's most likely to pay."

*(point at the propensity row)*

> "**Minus twenty-three thousand rupees. It loses money. It is worse than doing nothing.**"

**Pause here. Let it sit.**

---

## 0:35 – 1:20 · Why

> "Because 'likely to pay' is the wrong question.
>
> This customer" *(point at a bank_downtime row)* "had a twenty-minute bank outage. He retries
> tonight on his own, seventy percent of the time. He is the single most likely person in the
> batch to recover — so a propensity model puts him first. Contacting him costs money and
> changes nothing.
>
> And these two hundred and twenty-three" *(point at the archetype table)* "**cancel when you
> chase them.** Contacting them has negative value.
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
> It contacted eighty percent of the people who genuinely needed a nudge. Two percent of the
> self-recoverers. And **zero percent** of the people who cancel when chased.
>
> Result: we recovered ₹1,10,811 more than contacting everyone — while contacting sixty-five
> percent fewer customers."

---

## 2:10 – 2:50 · It's calibrated, not just lucky

> "Ranking correctly isn't enough. If it says plus thirty and delivers plus eight, you sized
> your budget against a number nobody should have trusted."

**Screen:** `node razorpay/calibration.mjs`

> "Held-out customers, randomised. Decile one: predicted +18.6, delivered +14.8. Decile ten:
> predicted minus five point one, delivered minus five point six — it correctly finds the group
> that gets *worse*.
>
> Mean absolute error under three percentage points. And where a decile is too thin to be
> honest, it **refuses to print a number** and says why."

---

## 2:50 – 3:40 · Bounded, gated, auditable

> "Every money action is explainable, bounded and gated."

**Screen:** the GOVERNANCE and AUDIT sections.

> "Budget: a hard stop that halts the batch mid-list. Approval tiers: under five hundred is
> automatic, above five thousand needs **two distinct people** — the same approver twice is
> rejected. Idempotency: a hash of the case and payload, checked against our own ledger before
> any upstream call.
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

**Screen:** one brief.

> "This is what the operator approving thirteen thousand rupees actually sees. Not 'blocked'.
> The whole reasoning, and every number in it traces to a record.
>
> A validator drops any sentence containing a figure that isn't in the evidence list. Right now:
> zero dropped.
>
> The ordering matters — JavaScript computes the numbers, a template writes the sentences, and a
> language model may only *rephrase*. Any rewrite that alters a number is thrown away. **The
> model never touches a figure.**"

---

## 4:20 – 4:45 · Live, and one failure

**Screen:** `node --env-file=.env razorpay/recover.mjs --live`

> "Approved actions become real Razorpay test-mode payment links, keyed by their idempotency
> key so a re-run cannot double-charge anyone."

**Screen:** kill the server, click Create.

> "And when something breaks — the verbatim error, on screen, button still usable. A failed
> action keeps a **null** external reference. We never synthesise a success."

---

## 4:45 – 5:00 · Close

> "Observation, a labelled dataset, a calibrated causal model, a governed executor, and a
> measured result on a held-out batch.
>
> The customers in this demo are synthetic and we say so on screen. The pipeline is not —
> `featurise` consumes exactly what Razorpay webhooks emit.
>
> The first time we ran this, it printed **'thesis does not hold'**. We fixed the model, not the
> threshold."

---

## Notes for the recording

- **Do not** show the architecture diagram before 3:00. It's context, not the point.
- Run the commands live. A terminal that actually executes beats any slide.
- The two moments that land: **propensity loses money** (0:30) and **0% of the cancel-when-chased
  group** (1:50). Slow down for both.
- Have `npm run recover` output pre-scrolled to MEASURE — do not make them watch it compute.
- If asked "where is the AI?": the causal model *is* the AI, and it's the right tool — an LLM
  cannot estimate a treatment effect. The LLM's job here is explanation, and it is fenced so it
  cannot touch a number.

# Delegation tasks — hand these to your other account

Each task below is **self-contained**: a copy-pasteable prompt, the files it touches, and an
acceptance test that either passes or fails. None of them need this conversation's context, and
none of them touch the same files as another, so they can run in parallel without conflicts.

**Model guidance.** T1, T2, T5, T6, T7 are Sonnet-class work — well-specified, mechanical, and
verifiable. T3 and T4 want the stronger model because they involve judgement about statistics
and prompt design that is easy to get subtly wrong.

**One rule to paste into every one of them:**

> Never invent a number. If something cannot be measured yet, return `null` with a reason string.
> Every claim an LLM makes must cite the ids of the rows it rests on, and any claim whose
> citations do not resolve against the database must be dropped, not softened.

---

## T1 · Razorpay test-mode adapter  `[Sonnet]  razorpay/rzp.mjs`  ← highest value

> Build `razorpay/rzp.mjs`, a zero-dependency Node module wrapping Razorpay **test-mode** APIs.
> Export: `createOrder({amount, currency, receipt, notes})`, `createPaymentLink({amount, customer,
> notes})`, `fetchPayment(id)`, and `verifyWebhook(rawBody, signature, secret)` implementing the
> documented HMAC-SHA256 check with a timing-safe compare.
> Also export `startWebhookServer({port, secret, onEvent})` handling `payment.captured`,
> `payment.failed` and `payment_link.paid`, normalising each into
> `{ ts, type, customer_id, amount, method, order_id }`.
> Read the key from `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`; throw a named error at import time
> if they are missing. Never log a secret. Retry 5xx with backoff; never retry a 4xx.
> **Acceptance:** with test keys in `.env`, a script creates an order, hits the payment link in a
> browser with a test card, and the webhook server prints a normalised `payment.captured`.

Why it matters: the brief says *"on Razorpay test-mode APIs"*. Without this the project is a
simulation with a Razorpay-shaped hole. This is the single highest-value delegated task.

---

## T2 · Calibration panel  `[Sonnet]  razorpay/calibrate.mjs` + a page section

> Read `razorpay/uplift.mjs` and `razorpay/bench.mjs` first.
> Build `calibrate.mjs` exporting `calibrationByDecile(scored, actuals)`: bucket customers into
> deciles of **predicted** uplift, and for each decile return predicted mean uplift vs **observed**
> uplift (treated conversion rate − control conversion rate within that decile), plus n per arm.
> Return `{ decile, predicted, observed, n_treated, n_control, ci90 }` and refuse any decile with
> fewer than 30 per arm — return `null` with a reason for that decile rather than a noisy number.
> Then render it as a single chart: predicted on x, observed on y, a 45° reference line, one dot
> per decile sized by n. Dots on the line mean the model is calibrated.
> **Acceptance:** `node razorpay/calibrate.mjs` prints the table; deciles below the n floor say so.

Why it matters: *"we predicted +13.8%, we measured +12.4%, error 1.4pp"* is the most persuasive
screen you can put in front of a judging panel, and it is the one thing a simulation cannot fake.

---

## T3 · Growth Council  `[Opus]  razorpay/council.mjs` + `razorpay/prompts/*.md`

> Build a five-role LLM layer that **proposes** interventions to test. Roles: Behavioural Analyst,
> Growth Strategist, Payments Analyst, Skeptic, Experiment Designer.
> Input: aggregate statistics computed **in JavaScript, not by the model** — conversion by segment,
> drop-off by funnel step, payment-method success rates, uplift quadrant counts.
> Output must match a strict JSON schema via tool-calling (not JSON parsed out of prose):
> `{ proposals: [{ id, name, hypothesis, applies_to_segment, primary_metric,
> minimum_detectable_effect, supporting_evidence: [stat_id] }] }`.
> **Hard constraints, state these in the system prompt:** the model may never output an effect
> size, only a direction and a minimum worth detecting. It may never name a statistic that was not
> in its input. The Skeptic's output is a required field, not an optional one — if it cannot find a
> problem with a proposal, that proposal is rejected.
> **Acceptance:** each proposal's `supporting_evidence` ids all resolve against the input stats; a
> validator drops any that do not, and the drop rate is logged.

Why the strong model: the failure mode here is a plausible-sentence generator. The constraints
above are what stop that, and they need to be got right the first time.

---

## T4 · Uplift model upgrade  `[Opus]  razorpay/uplift.mjs`

> `fitUplift` currently uses class-variable transformation over a hand-rolled logistic regression.
> Improve it without adding dependencies:
> 1. add k-fold cross-validation and report out-of-fold Qini, not in-sample
> 2. add a second estimator (an X-learner or a small gradient-boosted stump ensemble) and pick
>    between them **by out-of-fold Qini**, reporting which won and by how much
> 3. add `upliftCI(rows, x)` giving a bootstrap interval on an individual's estimated uplift, and
>    make `selectTargets` refuse anyone whose interval spans zero
> **Do not touch** the honesty gates, `evaluatePolicy`, or the benchmark protocol in `bench.mjs`.
> **Acceptance:** `node razorpay/bench.mjs` still prints THESIS HOLDS, out-of-fold Qini is reported
> and is lower than the current in-sample 29.4 (that is expected and correct), and the policy now
> declines customers whose uplift is not distinguishable from zero.

---

## T5 · Consent banner + beacon  `[Sonnet]  your canvas repo`

> In `Real-Time-Collaborative-Digital-Canvas`, implement the two patches in
> `backstage-live/patches/`. Read both `.md` files first — they are the spec.
> Build the consent banner **before** the beacon. It must state in the participant's own words what
> is recorded (joins, leaves, chat, canvas activity, whether this tab is in front of you) and what
> is not (your screen, your keystrokes, your other tabs, your camera feed), and declining must
> leave the meeting fully usable — make that actually true, not just written.
> Persist consent per participant. On decline, write no beacon and no transcript rows for them.
> **Acceptance:** join as host in one browser and participant in another. The participant sees the
> banner and zero companion UI. Switch their tab away for 10s: a `tab.hidden` and a `tab.visible`
> row appear in Mongo. Decline instead: no rows appear for that participant.

---

## T6 · Transcript pipeline  `[Sonnet]  backstage-live/src/ingest/transcript.mjs`

> Implement the batch path only (the spec's path A — ignore live STT).
> Take the Cloudinary recording URL from the Meeting document, send it to Deepgram with
> diarization on, and map each returned segment to a `speech.segment` row matching the schema in
> `backstage-live/src/ingest/normalize.mjs`.
> Map speaker labels ("0", "1") to real participant ids using join/leave times. **Store the mapping
> confidence, and where it is low leave the actor as `speaker_1` rather than guessing a name** — a
> wrongly attributed quote is worse than an anonymous one.
> Gate the whole thing on consent: throw a named error if any participant has `consent !== true`.
> Record cost per meeting in `ObsSession.costs.stt_usd`.
> **Acceptance:** after a real recorded meeting, `speech.segment` rows exist with real text; a
> meeting with one non-consenting participant produces zero transcript rows and a clear error.

---

## T7 · Pitch assets  `[Sonnet]  docs/`

> Produce three things from this repo, reading `README.md`, `razorpay/README.md` and
> `backstage-live/PLAN.md` first:
> 1. **Architecture diagram** as inline SVG — event ingestion → behavioural twin → uplift engine →
>    policy engine → Razorpay test mode → measured outcome → model update. Label which boxes are
>    built and which are planned, honestly.
> 2. **5-minute video script** with timestamps. Open on the measured result, not on the
>    architecture. The strongest 20 seconds is: blanket discounting loses ₹0.65 per rupee,
>    propensity targeting still loses ₹0.59, and only incrementality turns it positive at +₹0.38.
> 3. **One-page summary** for the repo README top: problem, approach, measured result, what is
>    real vs synthetic, what is next.
> **Do not** invent any number. Every figure must be traceable to a command in this repo.

---

## What I would keep for the strong model

Do **not** delegate: the honesty gates (`MIN_EPISODES`, the promotion gate, the "refuse when
underpowered" paths), the memory consolidation logic, or the experiment design in
`backstage-live/src/experiments/`. Those are where a subtle mistake produces a confident wrong
number, which is the one failure this project cannot survive.

## Suggested order

Run **T1 and T7 first** — T1 unblocks the live demo, T7 forces you to state the story early while
there is still time to fix what does not hold up. T2 depends on T1. T3, T4, T5, T6 are independent.

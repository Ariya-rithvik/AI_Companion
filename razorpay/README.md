# Behavioural Twin — incrementality engine

**Track 01 — "Build an agent that grows revenue for a merchant on Razorpay test-mode APIs."**
Judged on *measured results, audit trails and honest metrics*, with **every money action
explainable, bounded and gated**.

```bash
node razorpay/bench.mjs
```

---

## The thesis

Every marketing tool ranks customers by **P(convert)**. That is the wrong quantity.

The right one is the *causal* effect of the intervention:

```
tau(x) = P(convert | offer, x) − P(convert | no offer, x)
```

Because a discount given to someone who would have bought anyway is margin handed away, and a
discount given to a discount-averse loyalist actively costs you the sale. Neither is visible to
a propensity model, and both are ordinary in real merchant data.

**The pitch line: we grew net margin while discounting 78% fewer customers.**

## Measured result

14,000 customers · train 5,600 / validate 2,800 / deploy 5,600 · margin 60% · offer 10% off.
The model sees only randomised assignment and a binary outcome — never the generator.

| Policy | Targeted | Discount spend | Net margin | vs nothing | Return per ₹ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Do nothing | 0 | ₹0 | ₹69,80,707 | +0.0% | — |
| Discount everyone | 5,600 | ₹12,34,566 | ₹61,72,832 | **−11.6%** | −0.65 |
| Random 1,234 | 1,234 | ₹2,63,296 | ₹68,13,736 | −2.4% | −0.63 |
| **Propensity** top 1,234 | 1,234 | ₹4,15,417 | ₹67,34,930 | **−3.5%** | −0.59 |
| **Uplift** top 1,234 | 1,234 | ₹2,26,068 | **₹70,66,682** | **+1.2%** | **+0.38** |
| Policy engine (gated) | 1,234 | ₹1,91,613 | ₹70,32,419 | +0.7% | +0.27 |

Qini coefficient **29.4** on the untouched validation split (0 = no better than random).

Three things worth saying out loud, because they are the honest reading:

1. **Blanket discounting destroys 65 paise of margin per rupee spent.** Doing nothing beats it
   by ₹8.1L.
2. **Propensity targeting — the industry default — is still value-destroying** at −₹0.59 per
   rupee. Picking the people most likely to buy means paying the people who were going to buy.
3. **Only incrementality flips the sign.** Same audience size, less spend, more margin.

## What the gate is actually for

The gated policy earns slightly *less* than the raw uplift ranking, and that is reported rather
than hidden. Its job is not margin — it is the three words in the brief:

- **explainable** — every action carries its reason:
  `C5975 · persuadable · uplift 21.9pp · expected +₹240 for ₹170 of discount`
- **bounded** — a hard budget cap that stops mid-list (`budget exhausted`), plus an audience cap
- **gated** — sleeping dogs and sure things are blocked by rule, so a miscalibrated ranking can
  never send an offer to someone it would hurt

Every rejection carries a reason too. That is the audit trail.

## The four quadrants

| | Meaning | Action |
| --- | --- | --- |
| **Persuadable** | converts *because* of the offer | spend here — this is the only group that pays back |
| **Sure thing** | converts anyway | blocked — discounting is margin given away |
| **Lost cause** | unlikely either way | blocked — spending changes almost nothing |
| **Sleeping dog** | responds *worse* when pushed | blocked — the offer costs you the sale |

Recovery against archetypes the model was never told about: `persuadable → persuadable 97%`,
`loyalist_sensitive → sleeping_dog 51%`. Habitual buyers are still confused with persuadables
about half the time — their true effect is ~1pp, which is genuinely near the noise floor at this
sample size. Stated rather than smoothed over.

## Two engineering decisions that mattered

**The estimator.** The first version used a T-learner (fit treated, fit control, subtract). It
scored **Qini −2.33** — worse than random — and labelled habitual buyers persuadable, because a
few percentage points of effect vanish into the variance of a *difference of two fitted models*.
Switching to class-variable transformation (a single classifier on whether the outcome agrees
with the arm; Jaskowski & Jaroszewicz) took it to **+29.4**. Same data, right estimator.

**The features.** The first generator drove `tau` from price sensitivity but let it leave no
observable trace, so the model was being asked an unanswerable question. Price-sensitive
customers hunt coupons and premium buyers do not — `coupon_rate` and `coupon × log(AOV)` are the
signals that make the problem solvable, and both come straight from order data a merchant has.

## What is real and what is not

**Synthetic:** the customers. Labelled as such everywhere, including in the benchmark header.

**Real:** the method and the evaluation. Three-way split; the model sees only randomised
assignment plus a binary outcome; Qini on an untouched split; every policy scored on a deploy
split no model has seen; all policies compared at identical audience size so a win cannot come
from spending more.

`featurise()` consumes an event list — `order.created`, `payment.captured`, `payment.failed`,
`coupon.applied`, `checkout.started`. Those are Razorpay webhook payloads plus a merchant's own
checkout log. Point it at real data and nothing downstream changes.

## Files

```
twin.mjs     event stream -> behavioural state. Archetypes, ground truth, featurisation.
uplift.mjs   CVT uplift estimator, Qini, quadrants, budget-bounded policy engine.
bench.mjs    the benchmark above. Prints THESIS HOLDS / DOES NOT HOLD from the numbers.
```

## Next, in order

1. **Razorpay test-mode loop** — orders + payment links for the treated arm, webhooks back as
   outcomes. Closes observe → decide → act → measure with real API calls.
2. **Calibration panel** — predicted uplift vs measured uplift per decile. The screen that says
   *"we predicted +13.8%, we measured +12.4%, error 1.4pp"* is worth more than any simulation.
3. **Growth Council** — a thin LLM layer that *proposes* which levers to test (timing, format,
   follow-up, offer size, UPI-first) and writes the reason strings. It generates hypotheses; it
   never estimates effects. Keep it visibly downstream of the arithmetic.
4. **Reuse `../engine/`** — the experiment registry, bootstrap CI, promotion gate and memory
   already exist and are surface-agnostic. A checkout funnel is already one of its six surfaces.

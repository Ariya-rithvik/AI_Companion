# Track decision, and what Aegis changes

## 1. Why Track 03 and not Track 01

Read the two bars side by side — the bar is what you are judged on, not the blurb.

**Track 01** — *"Grow the merchant's revenue… or make them transactable by an AI buyer."*
Bar: *"Every money action explainable, bounded and gated. Show the audit trail and one failure
handled gracefully."*

**Track 03** — *"Detect revenue at risk, determine the right intervention, execute a bounded
recovery workflow."*
Bar: *"Don't just identify the problem. Show **measured money recovered across a batch**, with
compliant escalation, **stopping rules**, and an audit trail."*

Three reasons Track 03:

**a. Track 03's bar is a checklist we already half-satisfy; Track 01's is generic.**
"Measured money across a batch" is `npm run bench` — 5,600 customers, rupees, held-out split.
"Stopping rules" is the budget cap that halts mid-list with `budget exhausted`. "Audit trail" is
the reason string on every accept *and* every reject. Track 01's bar is satisfied by almost any
competent agent, which means it does not separate you.

**b. Track 01 will be crowded and its examples are demo-shaped.**
Conversational checkout, agent-readable catalog, upsell agent — these are UI-forward and easy to
start, so most entrants land there. Differentiation is hard when fifty teams ship a checkout chat.

**c. Our one novel claim is a recovery claim, not a growth claim.**
*"Everyone else's recovery agent contacts everyone. We measure who is actually recoverable,
spend only on them, and make more money contacting 78% fewer people."* That sentence only makes
sense inside Track 03.

**Not Track 02** — its bar is *"measured precision and recall on a held-out test set"* plus
false-positive cost. That is a detector's bar. We have a *decision* engine, not a classifier;
we would have to build a different thing to be judged well there.

---

## 2. What Aegis changes

Aegis is far more mature than anything in this repo, and it is strong in exactly the places
Backstage is weak.

| | Backstage (this repo) | Aegis |
| --- | --- | --- |
| Real payment-provider API calls | **none yet** | live refunds + dispute evidence |
| Approval gates | budget cap only | tiered: auto <$50 · one-click $50–500 · two-person $500+ |
| Audit trail | reason per decision | full case/event/finding/action tables |
| Citations | `cited_seqs` designed, not built | built — every claim chips back to a source row |
| Failure handling | one graceful failure | failed actions logged with verbatim upstream error, **never a synthesised success ref** |
| Multi-agent | none | coordinator + 5 parallel specialists, A2A agent cards |
| Deployed | localhost | Cloud Run, aegis.quest |
| **Deciding *who* to spend on** | **the uplift engine** | **absent** |

That last row is the whole point. Aegis answers *"what happened and what should we do about
this case?"* superbly. It never asks *"is this case worth spending money on at all?"* — and that
is the question the incrementality engine answers.

### The two halves compose into one Track 03 story

```
1  DETECT     revenue at risk        failed payments · checkout abandonment · disputes
2  QUALIFY    who is worth recovering   ← uplift engine.  THE NOVEL PART.
3  INVESTIGATE the specific case         ← Aegis's cited-brief pattern
4  EXECUTE    bounded recovery           ← Aegis's approval tiers + idempotency + audit
5  MEASURE    money actually recovered   ← bench.mjs, on a batch, held out
```

Step 2 is what nobody else will have. Steps 3–5 are what makes it credible rather than a demo.

**The line for the video:** *"A recovery agent that knows when not to spend. It recovers more
money by contacting 78% fewer customers — and every rupee it does spend carries a reason, a
budget it cannot exceed, and a receipt."*

---

## 3. Two things to check before you rely on Aegis

**a. It targets a different payment provider.** The track requires Razorpay test-mode APIs. The *patterns*
port cleanly; the adapters do not. That is task A5, and it is the critical path either way.

**b. It was submitted to another competition.** The Miny-Labs README says plainly:
*"Track 3 submission · Google for Startups AI Agents Challenge."* Many hackathons restrict
resubmitting work built for another, or require disclosure. **I do not know Razorpay's rule and
will not guess — check it before you build the plan around Aegis.**

The safe read regardless of that rule: reusing *your own architectural patterns* — approval
tiers, idempotency keys, "the LLM never holds write credentials", citations, verbatim failure
logging — is unambiguously fine and is most of the value. Lifting the submission whole is the
part that needs a rules check.

---

## 4. What to build, in order

**A5 · Razorpay adapter** — critical path. Nothing counts until a real Razorpay test-mode call
happens. Already specced in `TASKS-PARALLEL.md`.

**A7 (new) · Port Aegis's four safety patterns into `razorpay/policy.mjs`:**
1. Tiered approval by amount, not one flat budget
2. Idempotency key on every money action
3. The model proposes; a deterministic executor holds the credentials
4. Failed actions recorded with the verbatim upstream error — never synthesise a success

Patterns, re-implemented against Razorpay. Perhaps 150 lines.

**A8 (new) · Recovery cohort demo** — take a batch of failed Razorpay test-mode payments, run
the uplift engine to split recoverable from not, execute retries/links only on the recoverable
set, and report **money recovered vs money spent** with the audit trail. That single screen is
the Track 03 submission.

**Then** calibration (T2), then the pitch assets (A6/T7).

---

## 5. What I could not check

I read both READMEs completely. **I did not watch `demo.mp4`** — I cannot play video. If the
demo shows behaviour the README does not describe, I have not accounted for it; tell me what it
shows and I will fold it in.

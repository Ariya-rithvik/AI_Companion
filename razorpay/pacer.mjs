/**
 * Pacer — round-level policy auditor for the recovery batch.
 *
 * Ported from the pacer in Aegis, our earlier internal agent framework. The
 * design there is
 * right and the reasoning is worth restating, because it is the opposite of
 * what most agent projects do:
 *
 *   The model is the brain. This is a narrow set of RULES that watch the
 *   running state and step in when the brain is about to finalise on shaky
 *   ground.
 *
 * Why rules instead of more bullet points in a prompt:
 *   - A prompt is read once per round. It cannot observe cross-round state
 *     ("has this batch ever checked the budget?", "is this the third identical
 *     proposal?"). The pacer can.
 *   - Each rule is testable without an LLM in the loop.
 *   - Money-moving decisions need stronger pre-conclude invariants than a
 *     read-only report does. This is where they live.
 *
 * Design contract, kept from the original:
 *   - PURE. No I/O, no model calls, no clock. State in, decision out.
 *   - IDEMPOTENT. Each rule fires at most once per batch; the caller passes the
 *     already-fired ids so the same nudge cannot spam.
 *   - ESCAPE HATCH. A rule that has already fired once lets the batch through
 *     rather than deadlocking when the condition cannot be satisfied.
 */

/** @typedef {'proceed'|'nudge'|'halt'} PaceKind */

const proceed = () => ({ kind: 'proceed', rule: null, message: null });
const nudge = (rule, message, reason) => ({ kind: 'nudge', rule, message, reason });
const halt = (rule, message, reason) => ({ kind: 'halt', rule, message, reason });

/**
 * Aegis gates a refund on a finding that contains the arithmetic. Ours is the
 * same shape: an offer is margin given away, so the brief must show the sum that
 * justified it. A number with no visible derivation is a number nobody checked.
 */
const MATH_HINT = /(?:[-+]?\d[\d,]*(?:\.\d+)?\s*(?:pp|%)|₹\s?-?\d|[\d.]+\s*[x×*]\s*[\d.]+|=\s*-?[\d₹])/;

/* ───────────────────────── per-decision rules ───────────────────────── */

/**
 * Gate a single proposed action before it reaches the ledger.
 *
 * @param d      the scored decision { tau, pControl, pTreated, amount, action, ev, brief }
 * @param fired  Set of rule ids already fired for this batch
 */
export function judgeDecision(d, fired = new Set()) {
  const once = id => fired.has(id);

  // D1 — an offer costs margin; the brief must show the arithmetic behind it.
  if (d.action === 'link+off' && !once('D1_offer_math_missing')) {
    const text = briefText(d);
    if (!MATH_HINT.test(text)) {
      return nudge('D1_offer_math_missing',
        `Proposing a discount on ${inr(d.amount)} but the brief shows no arithmetic. `
        + 'Record the uplift and expected value that justified it before approving.',
        'offer without math-shaped brief');
    }
  }

  // D2 — never spend on a negative estimated effect, whatever the ranking says.
  if (d.tau < 0 && d.action !== 'none') {
    return halt('D2_negative_uplift',
      `Estimated effect is ${(d.tau * 100).toFixed(1)}pp — contacting this customer is `
      + 'expected to REDUCE recovery. Refusing.',
      'tau < 0 with a contact action');
  }

  // D3 — an effect inside the noise band is not a reason to spend money.
  if (d.action !== 'none' && Math.abs(d.tau) < 0.02 && !once('D3_noise_band')) {
    return nudge('D3_noise_band',
      `Estimated effect ${(d.tau * 100).toFixed(1)}pp is inside the noise band. `
      + 'Spending here buys nothing measurable.',
      '|tau| < 2pp');
  }

  // D4 — the expected value must actually be positive. A ranking can be right
  // about the ORDER and still put a loss-making action at the top.
  if (d.action !== 'none' && d.ev != null && d.ev <= 0) {
    return halt('D4_negative_ev',
      `Expected value ${inr(d.ev)} — the action costs more than it returns.`,
      'ev <= 0');
  }

  return proceed();
}

/* ───────────────────────── pre-conclude rules ───────────────────────── */

/**
 * Gate the whole batch before it is declared finished. These are the invariants
 * that only make sense across the run.
 *
 * @param s { approved, rejected, spend, budget, contactedByQuadrant, cohort, qini }
 */
export function judgeBatch(s, fired = new Set()) {
  const once = id => fired.has(id);

  // B1 — a budget that was never binding was never a stopping rule.
  if (s.budget == null || s.budget === Infinity) {
    return halt('B1_no_budget',
      'This batch ran without a budget. "Bounded" is a claim the run cannot support.',
      'budget missing');
  }

  // B2 — spending past the cap is the failure the cap exists to prevent.
  if (s.spend > s.budget) {
    return halt('B2_budget_exceeded',
      `Spent ${inr(s.spend)} against a cap of ${inr(s.budget)}.`,
      'spend > budget');
  }

  // B3 — money aimed at people who convert anyway is the classic dunning bug.
  const sure = s.contactedByQuadrant?.sure_thing ?? 0;
  const total = s.approved || 1;
  if (sure / total > 0.15 && !once('B3_sure_thing_leak')) {
    return nudge('B3_sure_thing_leak',
      `${Math.round((sure / total) * 100)}% of approved contacts are customers who recover `
      + 'unprompted. That spend buys nothing.',
      'sure_thing share > 15%');
  }

  // B4 — a sleeping dog is an action with negative expected value by definition.
  const dogs = s.contactedByQuadrant?.sleeping_dog ?? 0;
  if (dogs > 0) {
    return halt('B4_sleeping_dog_contacted',
      `${dogs} approved contact(s) go to customers whose recovery FALLS when chased.`,
      'sleeping_dog contacted');
  }

  // B5 — a model no better than random must not be used to allocate money.
  if (s.qini != null && s.qini <= 0) {
    return halt('B5_model_no_better_than_random',
      `Qini ${s.qini} — this model does not rank better than contacting at random. `
      + 'Contact everyone or nobody, but do not pretend this is targeting.',
      'qini <= 0');
  }

  // B6 — a batch that approves everything has not made a decision.
  if (s.approved > 0 && s.rejected === 0 && !once('B6_no_selection')) {
    return nudge('B6_no_selection',
      'Every candidate was approved. Either the gates are not binding or the '
      + 'budget is too large to be a constraint.',
      'zero rejections');
  }

  return proceed();
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function briefText(d) {
  if (typeof d.brief === 'string') return d.brief;
  if (d.brief?.claims) return d.brief.claims.map(c => c.text).join(' ');
  if (d.rationale) return String(d.rationale);
  return '';
}

const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

/**
 * Convenience: run every decision through the pacer, collecting the verdicts and
 * honouring idempotency across the batch. Returns the decisions the pacer
 * allowed plus everything it stopped, with reasons.
 */
export function pace(decisions) {
  const fired = new Set();
  const allowed = [], stopped = [], nudges = [];
  for (const d of decisions) {
    const v = judgeDecision(d, fired);
    if (v.kind === 'proceed') { allowed.push(d); continue; }
    fired.add(v.rule);
    if (v.kind === 'halt') stopped.push({ ...d, pacer: v });
    else { nudges.push({ ...d, pacer: v }); allowed.push(d); }   // a nudge warns, it does not block
  }
  return { allowed, stopped, nudges, fired: [...fired] };
}

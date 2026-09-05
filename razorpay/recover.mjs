/**
 * A8 — Revenue recovery on a batch of failed Razorpay payments.
 *
 *   node razorpay/recover.mjs                 dry run, no keys needed
 *   node --env-file=.env razorpay/recover.mjs --live   real test-mode payment links
 *
 * THIS IS THE SUBMISSION. Track 03 asks for an agent that "detects revenue at
 * risk, determines the right intervention, and executes a bounded recovery
 * workflow", judged on "measured money recovered across a batch, with compliant
 * escalation, stopping rules, and an audit trail". Each of those five is a
 * section below, in that order.
 *
 * The argument every other recovery agent gets wrong
 * --------------------------------------------------
 * Dunning tools contact every failed payment. That is wrong in two directions
 * at once, and both are ordinary in real payment data:
 *
 *   - SELF-RECOVERERS retry on their own within a day. A transient bank outage
 *     is not a lost customer. Contacting them costs money and recovers nothing
 *     that was not coming back anyway.
 *   - DUNNING-AVERSE customers cancel when chased. Chasing them has NEGATIVE
 *     value: you spend money to lose the subscription.
 *
 * A propensity model cannot see either. It ranks by "will this recover", so it
 * puts the self-recoverers at the very top of the contact list — the single
 * most expensive mistake available. Only incremental response separates
 * "recovers" from "recovers BECAUSE we acted".
 */

import { generateCustomers, featurise, rng } from './twin.mjs';
import { fitUplift, quadrant, qini, QUADRANT_COPY } from './uplift.mjs';
import { explain, validate, phrase, render } from './explain.mjs';
import { ActionLedger, tierFor as ledgerTier } from './policy.mjs';
import { pace, judgeBatch } from './pacer.mjs';

/* ─────────────────────────── economics ─────────────────────────── */

const MARGIN = 0.60;        // digital goods
const CONTACT_COST = 6;     // ₹ per outreach: SMS + link + amortised support
const INCENTIVE = 0.10;     // discount offered on the recovery link
const N = 9000;

/* Approval tiers — the Aegis pattern. A flat budget is not "compliant
 * escalation"; a tier ladder is. Amounts in rupees. */
const TIERS = [
  { max: 500, tier: 'auto', label: 'auto-approved' },
  { max: 5000, tier: 'one_click', label: 'operator one-click' },
  { max: Infinity, tier: 'two_person', label: 'two-person approval' },
];
const tierFor = amt => TIERS.find(t => amt <= t.max);

const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const pad = (s, w) => String(s).padEnd(w);
const rp = (s, w) => String(s).padStart(w);
const LIVE = process.argv.includes('--live');

/* ───────────────────── 1 · DETECT revenue at risk ───────────────────── */

/**
 * Why a payment failed is observable and it matters — but it does NOT determine
 * recoverability on its own, which is the trap. A bank outage and an abandoned
 * 3DS challenge look equally "transient" and behave completely differently.
 */
const FAILURES = {
  bank_downtime: { weight: 0.17, archetype: 'self_recoverer' },
  network_error: { weight: 0.11, archetype: 'self_recoverer' },
  three_ds_abandoned: { weight: 0.19, archetype: 'nudge_needed' },
  session_timeout: { weight: 0.14, archetype: 'nudge_needed' },
  insufficient_funds: { weight: 0.16, archetype: 'hard_fail' },
  card_expired: { weight: 0.09, archetype: 'hard_fail' },
  card_declined: { weight: 0.14, archetype: 'annoyed' },
};

/** Ground truth the model never sees. p0 = self-recovery; tau = effect of contact. */
const ARCH = {
  self_recoverer: { p0: 0.72, tau: 0.020, note: 'retries unprompted within 24h' },
  nudge_needed: { p0: 0.17, tau: 0.330, note: 'wants to pay, needs the link' },
  hard_fail: { p0: 0.06, tau: 0.055, note: 'card or funds genuinely dead' },
  annoyed: { p0: 0.41, tau: -0.115, note: 'cancels when chased' },
};

function buildBatch(seed = 21) {
  const rnd = rng(seed);
  const people = generateCustomers({ n: N, seed });
  const keys = Object.keys(FAILURES);
  const batch = [];

  for (const c of people) {
    // only a slice of customers have a failed payment in the window
    if (rnd() > 0.34) continue;

    let r = rnd(), reason = keys[keys.length - 1], acc = 0;
    for (const k of keys) { acc += FAILURES[k].weight; if (r <= acc) { reason = k; break; } }
    const arch = FAILURES[reason].archetype;
    const a = ARCH[arch];

    const f = featurise(c);
    const amount = Math.max(199, Math.round(f.aov * (0.7 + rnd() * 0.7))) || 1499;

    // Behaviour modulates the archetype: an engaged repeat buyer self-recovers
    // more readily; a stale one needs the nudge. Both are observable.
    const engaged = f.x[1];                       // captured payments / 10
    const stale = Math.min(1, f.daysSince / 90);
    const p0 = Math.max(0.02, Math.min(0.95, a.p0 + engaged * 0.10 - stale * 0.12 + (rnd() - 0.5) * 0.06));
    const tau = a.tau + (arch === 'nudge_needed' ? stale * 0.06 : 0) + (rnd() - 0.5) * 0.03;

    batch.push({
      id: c.id,
      order_id: 'order_' + c.id.slice(1) + '_' + Math.floor(rnd() * 1e5).toString(36),
      amount,
      reason,
      archetype: arch,
      attempts: 1 + Math.floor(rnd() * 3),
      // model input: behavioural history + observable failure context
      x: [...f.x, ...oneHot(reason, keys), Math.log1p(amount) / 10, (1 + Math.floor(rnd() * 3)) / 3],
      feat: f,                       // kept for the explainer's citations, never for the model
      truth: { p0, p1: Math.max(0.01, Math.min(0.98, p0 + tau)), tau },
    });
  }
  return batch;
}

const oneHot = (v, keys) => keys.map(k => (k === v ? 1 : 0));

/* ────────────────── 2 · QUALIFY — who is worth contacting ────────────────── */

const batch = buildBatch();
const rnd = rng(99);
const shuffled = [...batch].sort(() => rnd() - 0.5);
const train = shuffled.slice(0, Math.floor(batch.length * 0.5));
const deploy = shuffled.slice(Math.floor(batch.length * 0.5));

/** A prior recovery experiment: half the failures were contacted, half were not. */
function runRCT(rows, seed) {
  const r = rng(seed);
  return rows.map(o => {
    const treated = r() < 0.5 ? 1 : 0;
    const p = treated ? o.truth.p1 : o.truth.p0;
    return { id: o.id, x: o.x, treated, converted: r() < p ? 1 : 0 };
  });
}

const trainRows = runRCT(train, 4242);
const model = fitUplift(trainRows);

console.log('');
console.log('  RAZORPAY REVENUE RECOVERY — batch run' + (LIVE ? '  [LIVE test-mode]' : '  [DRY RUN]'));
console.log('  ' + '='.repeat(76));
console.log('  1 · DETECT');
console.log('      ' + batch.length + ' failed payments in the window, '
  + inr(batch.reduce((s, o) => s + o.amount, 0)) + ' at risk');
const byReason = {};
for (const o of batch) byReason[o.reason] = (byReason[o.reason] ?? 0) + 1;
console.log('      ' + Object.entries(byReason).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => k + ' ' + v).join(' · '));

if (!model.ok) { console.error('\n  model refused to fit: ' + model.reason + '\n'); process.exit(1); }

const validRows = runRCT(deploy, 777);
const q = qini(validRows.map(r => ({ ...r, score: model.uplift(r.x) })));

console.log('');
console.log('  2 · QUALIFY');
console.log('      uplift model trained on ' + model.n.treated + ' contacted / ' + model.n.control
  + ' not contacted (prior randomised recovery test)');
console.log('      Qini ' + q.coefficient + ' on a held-out split   (0 = no better than contacting at random)');

const scored = deploy.map(o => {
  const pC = model.pControl(o.x);
  const pT = model.pTreated(o.x);
  return { ...o, pControl: pC, pTreated: pT, tau: pT - pC, quadrant: quadrant(pC, pT - pC) };
});

const qTally = {};
for (const o of scored) qTally[o.quadrant] = (qTally[o.quadrant] ?? 0) + 1;
console.log('      ' + Object.entries(qTally).map(([k, v]) => k.replace('_', ' ') + ' ' + v).join(' · '));

/* ───────────── 3 · EXECUTE — bounded, gated, idempotent ───────────── */

/*
 * The budget has to be a fraction of what indiscriminate outreach would ACTUALLY
 * cost, not of the head-count. Sizing it as count x ₹6 ignored the incentive,
 * which is two orders of magnitude larger on a ₹13,000 order — the first run
 * bought six contacts against 1,555 and the comparison was meaningless.
 */
const spendIfContactAll = scored.reduce(
  (s, o) => s + CONTACT_COST + o.pTreated * o.amount * INCENTIVE, 0);
const budget = Math.round(spendIfContactAll * 0.35);   // binding: about a third

/**
 * "Determines the RIGHT intervention" — there are two, and they are not
 * interchangeable.
 *
 *   link      a payment link. Costs ~₹6. Recovers most of the uplift, because
 *             most failures are friction, not price.
 *   link+off  the same link with a discount attached. Costs ₹6 PLUS the
 *             incentive on every recovery it produces, including the ones the
 *             link alone would have produced.
 *
 * The discount only earns its keep when the extra uplift it buys beats the
 * margin it gives away on recoveries that were already coming:
 *
 *     LINK_SHARE x tau x margin  >  p(recover) x incentive
 *
 * For a 3DS drop-off that is true; for a bank-outage self-recoverer it is
 * wildly false, and a single-action model cannot tell them apart.
 */
const LINK_SHARE = 0.65;        // of total uplift the link alone captures

function decide(o) {
  const full = o.tau * o.amount * MARGIN;

  const link = { action: 'link', gain: full * LINK_SHARE, cost: CONTACT_COST };
  const off = {
    action: 'link+off',
    gain: full,
    cost: CONTACT_COST + o.pTreated * o.amount * INCENTIVE,
  };
  link.ev = link.gain - link.cost;
  off.ev = off.gain - off.cost;

  const best = off.ev > link.ev ? off : link;
  return { ...o, ...best, alt: best === off ? link : off, tier: tierFor(o.amount) };
}

const idempotencyKey = o => 'rcv_' + o.order_id + '_' + o.attempts;

function runPolicy(candidates, { gated }) {
  const ranked = candidates.map(decide).sort((a, b) => b.ev - a.ev);
  const approved = [], rejected = [], queue = { auto: 0, one_click: 0, two_person: 0 };
  const seen = new Set();
  let spend = 0;

  for (const o of ranked) {
    let why = null;
    const key = idempotencyKey(o);

    if (seen.has(key)) why = 'duplicate action for this order+attempt (idempotency)';
    else if (gated && (o.quadrant === 'sleeping_dog')) why = 'blocked: chasing this customer historically reduces recovery';
    else if (gated && o.quadrant === 'sure_thing') why = 'blocked: recovers unprompted — outreach buys nothing';
    else if (gated && o.ev <= 0) why = 'expected value ' + inr(o.ev) + ' — not worth the outreach';
    else if (spend + o.cost > budget) why = 'budget exhausted (stopping rule)';

    if (why) { rejected.push({ ...o, why }); continue; }
    seen.add(key);
    spend += o.cost;
    queue[o.tier.tier]++;
    approved.push({ ...o, key });
  }
  return { approved, rejected, spend };
}

/* ─────────────── 4 · MEASURE — against what really happens ─────────────── */

/**
 * Scored on TRUE response. In production this is the held-out arm instead.
 * @param plan Map<id, 'link' | 'link+off'>  which intervention each one gets
 */
function measure(plan) {
  const m = plan instanceof Map ? plan : new Map([...plan].map(id => [id, 'link+off']));
  let recovered = 0, gross = 0, outreach = 0, incentive = 0, offers = 0;
  for (const o of scored) {
    const act = m.get(o.id);
    const p = !act ? o.truth.p0
      : act === 'link' ? Math.min(0.98, o.truth.p0 + LINK_SHARE * o.truth.tau)
        : o.truth.p1;
    recovered += p;
    gross += p * o.amount * MARGIN;
    if (act) {
      outreach += CONTACT_COST;
      if (act === 'link+off') { incentive += p * o.amount * INCENTIVE; offers++; }
    }
  }
  const spent = outreach + incentive;
  return { recovered, gross, spent, net: gross - spent, contacted: m.size, offers };
}

const gated = runPolicy(scored, { gated: true });
const K = gated.approved.length;
const planOf = (ids, act) => new Map(ids.map(id => [id, act]));
const allIds = scored.map(o => o.id);
const byPropensity = [...scored].sort((a, b) => b.pTreated - a.pTreated).slice(0, K).map(o => o.id);
const byUplift = [...scored].sort((a, b) => b.tau - a.tau).slice(0, K).map(o => o.id);

const doNothing = measure(new Map());
const rows = [
  ['Contact nobody', measure(new Map())],
  ['Everyone, link only', measure(planOf(allIds, 'link'))],
  ['Everyone, link + offer', measure(planOf(allIds, 'link+off'))],
  ['Propensity top ' + K, measure(planOf(byPropensity, 'link+off'))],
  ['Uplift top ' + K, measure(planOf(byUplift, 'link+off'))],
  ['Policy engine (gated)', measure(new Map(gated.approved.map(o => [o.id, o.action])))],
];

console.log('');
console.log('  3 · EXECUTE   budget ' + inr(budget) + '   tiers: auto <' + inr(500)
  + ' · one-click <' + inr(5000) + ' · two-person above');
console.log('');
console.log('  4 · MEASURE');
console.log('  ' + pad('POLICY', 24) + rp('CONTACTED', 10) + rp('RECOVERED', 11)
  + rp('OFFERS', 8) + rp('SPENT', 11) + rp('NET MARGIN', 13) + rp('VS NOTHING', 12));
console.log('  ' + '-'.repeat(89));
for (const [name, m] of rows) {
  const d = m.net - doNothing.net;
  console.log('  ' + pad(name, 24) + rp(m.contacted, 10) + rp(m.recovered.toFixed(0), 11)
    + rp(m.offers ?? 0, 8) + rp(inr(m.spent), 11) + rp(inr(m.net), 13)
    + rp((d >= 0 ? '+' : '') + inr(d), 12));
}

const nothing = rows.find(r => r[0] === 'Contact nobody')[1];
const prop = rows.find(r => r[0].startsWith('Propensity'))[1];
const pol = rows.find(r => r[0].startsWith('Policy'))[1];

/*
 * Compare against the BEST blanket policy, not a chosen one.
 *
 * This previously compared only against "Everyone, link + offer" and called it
 * "contacting everyone". That was the flattering half of the comparison: the
 * link-only campaign is the stronger baseline of the two, and against it the
 * margin is much smaller. Anyone reading the table above would have seen the
 * headline disagree with the rows it sits under.
 *
 * Naming the baseline is the fix, and beating the better one is a stricter test.
 */
const blankets = rows.filter(r => r[0].startsWith('Everyone')).map(r => ({ name: r[0], m: r[1] }));
const best = blankets.reduce((a, b) => (b.m.net > a.m.net ? b : a));

console.log('');
console.log('  ' + '-'.repeat(76));
if (pol.net > best.m.net && pol.net > prop.net) {
  console.log('  vs doing nothing        ' + rp('+' + inr(pol.net - nothing.net), 12)
    + '   the headline number');
  console.log('  vs propensity targeting ' + rp('+' + inr(pol.net - prop.net), 12)
    + '   that policy is underwater by ' + inr(Math.abs(prop.net - nothing.net)));
  console.log('  ' + pad('vs ' + best.name.replace('Everyone, ', 'blanket '), 24)
    + rp('+' + inr(pol.net - best.m.net), 12)
    + '   strongest baseline, at ' + Math.round((1 - pol.contacted / best.m.contacted) * 100)
    + '% fewer contacts');
} else {
  console.log('  Gated policy did NOT win on this run. Reporting it rather than tuning until it does.');
  console.log('  gated ' + inr(pol.net) + ' · propensity ' + inr(prop.net)
    + ' · best blanket (' + best.name + ') ' + inr(best.m.net));
}

/* ───────────────────── 5 · AUDIT TRAIL ───────────────────── */

const qCount = { auto: 0, one_click: 0, two_person: 0 };
for (const o of gated.approved) qCount[o.tier.tier]++;

/*
 * Each decision is explained from its own evidence and then validated: any
 * sentence containing a number that is not in the evidence list is dropped, not
 * softened. That gate is what makes this an audit trail rather than a summary.
 */
let dropped = 0;
const briefs = new Map();
function briefFor(o) {
  if (!briefs.has(o.id)) {
    const b = validate(explain(o, o.feat));
    dropped += b.dropped.length;
    briefs.set(o.id, b);
  }
  return briefs.get(o.id);
}
async function brief(o) {
  return render(await phrase(briefFor(o), null));   // null = deterministic
}

/* ───────── governance: the pacer sees what a prompt cannot ───────── */

// Each approved row carries its own brief so rule D1 can check the arithmetic.
const paced = pace(gated.approved.map(o => ({ ...o, brief: briefFor(o) })));

const contactedByQuadrant = {};
for (const o of paced.allowed) {
  contactedByQuadrant[o.quadrant] = (contactedByQuadrant[o.quadrant] ?? 0) + 1;
}
const batchVerdict = judgeBatch({
  approved: paced.allowed.length,
  rejected: gated.rejected.length + paced.stopped.length,
  spend: gated.spend,
  budget,
  qini: q.coefficient,
  contactedByQuadrant,
});

// Every surviving action goes through the ledger: hashed idempotency key,
// approval tier, and a state machine that refuses to fire twice.
const ledger = new ActionLedger({ budget });
for (const o of paced.allowed) {
  ledger.propose({
    caseId: o.order_id, kind: 'recovery_payment_link',
    payload: { order_id: o.order_id, amount_paise: Math.round(o.amount * (1 - INCENTIVE) * 100),
      action: o.action, reason: o.reason },
    amount: o.amount, cost: o.cost,
    rationale: 'uplift ' + (o.tau * 100).toFixed(1) + 'pp · EV ' + inr(o.ev),
  });
}
const led = ledger.summary();

/*
 * Defence in depth. The pacer is the LAST line, so on a healthy run it should
 * catch nothing — the quadrant gates and the EV floor already did. That makes
 * for a weak demonstration, so we also run it over the ungated uplift ranking:
 * the same list a team would ship if they had the model but not the gates.
 * What it catches there is what the pacer is actually for.
 */
const ungated = [...scored].sort((a, b) => b.pTreated - a.pTreated).slice(0, K)
  .map(decide).map(o => ({ ...o, brief: briefFor(o) }));
const pacedUngated = pace(ungated);

console.log('');
console.log('  5 · GOVERNANCE');
console.log('      pacer      ' + paced.stopped.length + ' halted · ' + paced.nudges.length
  + ' nudged · rules fired: ' + (paced.fired.join(', ') || 'none — earlier gates caught everything'));
console.log('      same rules on the PROPENSITY list (the one that lost money): '
  + pacedUngated.stopped.length + ' would have been halted, '
  + pacedUngated.nudges.length + ' nudged');
for (const st of pacedUngated.stopped.slice(0, 2)) {
  console.log('        would HALT ' + st.id + '  ' + st.pacer.message);
}
for (const st of paced.stopped.slice(0, 2)) {
  console.log('        HALT ' + st.id + '  ' + st.pacer.message);
}
for (const nd of paced.nudges.slice(0, 1)) {
  console.log('        NUDGE ' + nd.id + '  ' + nd.pacer.message);
}
console.log('      batch      ' + batchVerdict.kind.toUpperCase()
  + (batchVerdict.message ? ' — ' + batchVerdict.message : ' — all invariants hold'));
console.log('      ledger     ' + led.skipped + ' skipped (duplicate/budget) · awaiting approval: '
  + (Object.entries(led.awaiting_approval).map(([k, v]) => k.replace('_', '-') + ' ' + v).join(' · ') || 'none'));
console.log('      auto-approved ' + ledger.byState('approved').length
  + ' under ' + inr(500) + '; everything above needs a human');

console.log('');
console.log('  6 · AUDIT TRAIL');
console.log('      approved ' + gated.approved.length + '   ('
  + Object.entries(qCount).map(([k, v]) => k.replace('_', '-') + ' ' + v).join(' · ') + ')');
console.log('      declined ' + gated.rejected.length + '   spend ' + inr(gated.spend) + ' of ' + inr(budget));
console.log('');
for (const o of gated.approved.slice(0, 2)) {
  console.log(await brief(o));
  console.log('      idempotency ' + o.key + '  ·  ' + o.tier.label);
  console.log('');
}
const shown = new Set();
for (const o of gated.rejected) {
  const kind = o.why.split('(')[0].split('—')[0].trim();
  if (shown.has(kind) || shown.size >= 3) continue;
  shown.add(kind);
  console.log(await brief(o));
  console.log('');
}
console.log('      claims dropped for unsupported numbers: ' + dropped
  + (dropped === 0 ? '   (every sentence traces to evidence)' : ''));

/* ───────── recovery of the archetypes the model was never told ───────── */

const conf = {};
for (const o of scored) {
  (conf[o.archetype] ??= {});
  conf[o.archetype][o.quadrant] = (conf[o.archetype][o.quadrant] ?? 0) + 1;
}
/*
 * The decision-relevant question is not "did the model label the archetype
 * correctly" — it is "who did we actually spend money on". A model can put a
 * self-recoverer in the wrong bucket and still, correctly, not contact them.
 * This is the number that maps to rupees.
 */
const contactedSet = new Set(gated.approved.map(o => o.id));
const offerSet = new Set(gated.approved.filter(o => o.action === 'link+off').map(o => o.id));

console.log('');
console.log('      who did we actually spend on?   (the model was never told these labels)');
console.log('       ' + pad('archetype', 16) + rp('in batch', 9) + rp('contacted', 11)
  + rp('offered', 9) + '   true uplift');
for (const [arch, meta] of Object.entries(ARCH)) {
  const of = scored.filter(o => o.archetype === arch);
  if (!of.length) continue;
  const c = of.filter(o => contactedSet.has(o.id)).length;
  const off = of.filter(o => offerSet.has(o.id)).length;
  console.log('       ' + pad(arch, 16) + rp(of.length, 9)
    + rp(Math.round((c / of.length) * 100) + '%', 11)
    + rp(Math.round((off / of.length) * 100) + '%', 9)
    + rp((meta.tau >= 0 ? '+' : '') + (meta.tau * 100).toFixed(1) + 'pp', 14)
    + '   ' + meta.note);
}

/* ───────────────────── live Razorpay execution ───────────────────── */

console.log('');
if (!LIVE) {
  console.log('  DRY RUN — no Razorpay calls made. Re-run with real test-mode keys:');
  console.log('      node --env-file=.env razorpay/recover.mjs --live');
  console.log('  Each approved row would create one test-mode payment link, keyed by its');
  console.log('  idempotency key so a re-run cannot double-charge anyone.');
} else {
  const { createPaymentLink, preflight } = await import('./rzp.mjs');

  // Prove the credential works before using it to move money. Placeholder keys
  // carry the right prefix and the right length; only a real call tells them
  // apart from a working one.
  const pf = await preflight();
  if (!pf.ok) {
    console.log('  LIVE ABORTED — the keys in .env do not authenticate.');
    console.log('      ' + pf.reason);
    console.log('');
    console.log('  Get test-mode keys: dashboard.razorpay.com -> Settings -> API Keys');
    console.log('  -> Generate Test Key. Put BOTH halves in .env:');
    console.log('      RAZORPAY_KEY_ID=rzp_test_...      (shown once)');
    console.log('      RAZORPAY_KEY_SECRET=...           (shown once - copy it now)');
    console.log('');
    console.log('  Nothing above this line depended on the network. The measured');
    console.log('  result stands; only the link creation below is unavailable.');
  } else if (pf.mode === 'live') {
    // Refuse real money. This harness targets synthetic customers.
    console.log('  LIVE ABORTED — those are LIVE keys (rzp_live_). This batch runs against');
    console.log('  synthetic customers and must never touch a real account. Use test keys.');
  } else {
    const sample = gated.approved.slice(0, 3);
    console.log('  LIVE (test mode) — creating ' + sample.length + ' payment links');
    for (const o of sample) {
      try {
        const link = await createPaymentLink({
          amount: Math.round(o.amount * (1 - INCENTIVE) * 100),         // paise
          customer: { name: o.id, email: o.id.toLowerCase() + '@example.test' },
          notes: { order_id: o.order_id, idempotency_key: o.key, reason: o.reason },
        });
        console.log('   OK  ' + o.id + '  ' + (link.short_url ?? link.id));
      } catch (e) {
        // A failed action is recorded verbatim. We never synthesise a success ref.
        console.log('   ERR ' + o.id + '  ' + (e?.message ?? e));
      }
    }
  }
}
console.log('');

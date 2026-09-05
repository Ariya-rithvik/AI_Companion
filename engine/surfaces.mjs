/**
 * Surface packs.
 *
 * Each pack is data, not code: nouns, a stage table, a segment mix, the levers
 * an experiment may pull, and the economics of one run. The kernel in core.mjs
 * consumes all six identically — which is the whole argument. A webinar and a
 * pull-request queue differ in vocabulary and constants, not in mechanism.
 *
 * Contract (everything below is required unless marked optional):
 *   identity   id, label, blurb, title, view, operator, companion
 *   nouns      actorNoun, actorPlural, actorNames, focusNoun, signalNoun
 *   clock      clock, stageUnit, tickSeconds, horizon, arrivalWindow
 *   cohort     cohort, segments{ weight, dropMult, intent, focus, color }
 *   flow       stages[{ id, label, headline, from, to, drop, focus, interactive }]
 *   dynamics   fatigue, drift, idleCap, burstThreshold, churnWindow
 *   outcome    outcomeGate, outcomeIntent, economics{ unitValue, winRate, sessionCost, outcomeNoun }
 *   content    lines[], reactions[], events{}, reasons{}, nudges{}
 *   levers     levers[{ id, label, hypo, dropMult, focus, at, intent, cost, transfers[] }]
 */

/** Fill in the dynamics that are just proportions of the run length. */
const withDynamics = s => ({
  fatigue: 0.0011,     // per-tick penalty for going quiet, capped by idleCap
  reversion: 0.06,     // how hard focus pulls back toward its baseline each tick
  focusSag: 0.42,      // how far the baseline itself declines across a whole run
  idleCap: s.horizon / 5,
  churnWindow: s.horizon / 8,
  outcomeGate: s.outcomeGate ?? s.horizon / 2,
  outcomeIntent: 0.58,
  burstThreshold: 4,
  actorNames: 'person',
  clock: 'mmss',
  ...s,
});

/* ═══════════════════════════════ 1. webinar ═══════════════════════════════ */

export const webinar = withDynamics({
  id: 'webinar',
  leverGain: 0.09,
  label: 'Webinar / live meeting',
  blurb: 'A 40-minute product webinar. The companion sits in the call and nobody but the host can see it.',
  title: 'Agent Orchestration in Production',
  view: 'tiles',
  operator: 'host', companion: 'companion',
  actorNoun: 'attendee', actorPlural: 'attendees',
  focusNoun: 'Room attention', signalNoun: 'Meeting chat',
  clock: 'mmss', stageUnit: 60, tickSeconds: 15, horizon: 40, arrivalWindow: 90,
  cohort: 180,
  segments: {
    buyer: { label: 'Buyer', weight: 0.18, dropMult: 0.75, intent: 0.62, focus: 0.66, color: '#0d7a4f' },
    practitioner: { label: 'Practitioner', weight: 0.42, dropMult: 1.00, intent: 0.34, focus: 0.58, color: '#2563a8' },
    student: { label: 'Student', weight: 0.28, dropMult: 1.35, intent: 0.08, focus: 0.44, color: '#b0721a' },
    competitor: { label: 'Competitor', weight: 0.12, dropMult: 0.60, intent: 0.02, focus: 0.72, color: '#5b4bb8' },
  },
  stages: [
    { id: 'intro', label: 'Welcome & housekeeping', headline: 'Welcome - Agent Orchestration in Production', from: 0, to: 4, drop: 0.0090, focus: -0.020, interactive: false },
    { id: 'problem', label: 'The problem', headline: 'Why 68% of agent pilots never ship', from: 4, to: 9, drop: 0.0060, focus: 0.010, interactive: false },
    { id: 'demo', label: 'Live demo', headline: 'Live: orchestrating 5 agents on one task', from: 9, to: 20, drop: 0.0028, focus: 0.048, interactive: true },
    { id: 'pricing', label: 'Pricing & packaging', headline: 'Pricing & packaging', from: 20, to: 26, drop: 0.0145, focus: -0.042, interactive: false, reason: 'price_shock' },
    { id: 'qa', label: 'Q&A', headline: 'Q&A - ask anything', from: 26, to: 35, drop: 0.0050, focus: 0.022, interactive: true },
    { id: 'cta', label: 'Next steps', headline: 'Book a design partner slot', from: 35, to: 40, drop: 0.0080, focus: 0.000, interactive: false },
  ],
  economics: { unitValue: 18000, winRate: 0.22, sessionCost: 6200, outcomeNoun: 'MQL' },
  events: { stage: 'slide.change', join: 'attendee.join', leave: 'attendee.leave', signal: 'chat.message', react: 'reaction', deep: 'poll.answered', save: 'agent.save', capture: 'capture.frame', nudge: 'nudge.host' },
  reasons: { collapse: 'attention_collapse', idle: 'tab_switch_decay', hard: 'hard_stop' },
  reactions: ['thumbsup', 'fire', 'clap', 'mindblown'],
  lines: ['is this recorded?', 'the orchestration graph - is that open source?', 'can it run on-prem?', 'what happens when a sub-agent fails mid-run?', 'pricing for 50 seats?', 'does it do eval replay?', '+1 to the retry question', 'we tried this with glue code, way more brittle', 'link to the docs?', 'how do you handle rate limits across agents?', 'this is exactly our problem', 'can I get these slides?'],
  nudges: {
    burst: (n, st) => `Drop-off burst on "${st.label}". Ask a live question in the next 20s - rooms that do recover ~11% of the bleed.`,
    cliff: (p, st) => `Attention fell ${p} pts in 2 minutes. Switch to the demo tab or drop a poll - this pattern preceded 3 of your last 4 exit bursts.`,
  },
  levers: [
    { id: 'poll_at_8', label: 'Interactive poll at minute 8', hypo: 'A poll before the demo re-anchors attention and cuts demo-window bleed.', dropMult: 0.88, focus: 0.055, at: 8, intent: 0.02, cost: 0, inject: 'Where are you with agents today?', injectSpan: 0.5, transfers: ['docs', 'onboarding'] },
    { id: 'pricing_after_qa', label: 'Move pricing after Q&A', hypo: 'Pricing lands on a warmer room once objections are already answered.', dropMult: 0.72, focus: 0.030, at: 26, intent: 0.05, cost: 0, transfers: ['checkout'], reshape: st => { const p = st.find(x => x.id === 'pricing'), q = st.find(x => x.id === 'qa'), c = st.find(x => x.id === 'cta'); p.from = 27; p.to = 33; p.drop = 0.0180; q.from = 20; q.to = 27; q.focus = 0.016; q.signalMult = 0.62; c.from = 33; c.focus = -0.015; return st.sort((a, b) => a.from - b.from); } },
    { id: 'intro_trim', label: 'Trim intro to two minutes', hypo: 'Housekeeping is the single largest early-exit cause; cut it.', dropMult: 0.93, focus: 0.040, at: 0, intent: 0.01, cost: 0, transfers: ['docs', 'checkout'], reshape: st => { st.find(x => x.id === 'intro').to = 2.2; st.find(x => x.id === 'problem').from = 2.2; return st; } },
    { id: 'demo_first', label: 'Open cold with the live demo', hypo: 'Lead with proof, not context. Buys six minutes of goodwill.', dropMult: 0.86, focus: 0.070, at: 2, intent: 0.03, cost: 0, transfers: ['docs'] },
    { id: 'qa_teaser', label: 'Tease the Q&A up front', hypo: 'A named promise ("pricing answered at 26:00") holds fence-sitters.', dropMult: 0.94, focus: 0.020, at: 1, intent: 0.01, cost: 0, transfers: ['support'] },
    { id: 'chat_prompt_5m', label: 'Chat prompt every 5 minutes', hypo: 'Micro-commitments keep the tab in the foreground.', dropMult: 0.95, focus: 0.030, at: 5, intent: 0.02, cost: 0, transfers: ['onboarding'] },
    { id: 'exit_intent', label: 'Agent exit-intent save', hypo: 'When the companion sees attention collapse it fires a targeted save offer.', dropMult: 0.90, focus: 0, at: 0, intent: 0.04, cost: 240, rescue: 0.34, transfers: ['checkout', 'onboarding', 'docs'] },
    { id: 'buyer_breakout', label: 'Buyer-only breakout at minute 30', hypo: 'Route high-intent attendees to a smaller room instead of losing them in the CTA slog.', dropMult: 0.97, focus: 0.015, at: 30, intent: 0.09, cost: 400, transfers: ['support'] },
  ],
});

/* ══════════════════════════════ 2. checkout ══════════════════════════════ */

export const checkout = withDynamics({
  id: 'checkout',
  leverGain: 0.2,
  outcomeIntent: 0.34,
  label: 'Checkout funnel',
  blurb: 'Shoppers moving cart to confirmation. Same model: the abandon hazard just sits on the payment step instead of the pricing slide.',
  title: 'Storefront checkout — Tuesday peak',
  view: 'funnel',
  operator: 'storefront', companion: 'companion',
  actorNoun: 'shopper', actorPlural: 'shoppers',
  focusNoun: 'Session intent', signalNoun: 'Support chat',
  clock: 'mmss', stageUnit: 60, tickSeconds: 10, horizon: 14, arrivalWindow: 120,
  cohort: 420,
  segments: {
    returning: { label: 'Returning', weight: 0.22, dropMult: 0.62, intent: 0.68, focus: 0.72, color: '#0d7a4f' },
    intent_high: { label: 'High intent', weight: 0.26, dropMult: 0.88, intent: 0.48, focus: 0.62, color: '#2563a8' },
    browser: { label: 'Browsing', weight: 0.34, dropMult: 1.42, intent: 0.16, focus: 0.42, color: '#b0721a' },
    price_check: { label: 'Price checking', weight: 0.18, dropMult: 1.65, intent: 0.09, focus: 0.5, color: '#5b4bb8' },
  },
  stages: [
    { id: 'cart', label: 'Cart review', headline: '3 items · $214.00 subtotal', from: 0, to: 3, drop: 0.0115, focus: 0.010, interactive: false },
    { id: 'shipping', label: 'Shipping details', headline: 'Where should this go?', from: 3, to: 6, drop: 0.0140, focus: -0.020, interactive: false },
    { id: 'ship_cost', label: 'Shipping cost shown', headline: '+ ₹149 standard shipping', from: 6, to: 8, drop: 0.0290, focus: -0.055, interactive: false, reason: 'shipping_shock' },
    { id: 'payment', label: 'Payment', headline: 'UPI · Card · Netbanking', from: 8, to: 11, drop: 0.0180, focus: -0.010, interactive: true },
    { id: 'confirm', label: 'Review & confirm', headline: 'Place your order', from: 11, to: 14, drop: 0.0060, focus: 0.030, interactive: false },
  ],
  economics: { unitValue: 214, winRate: 1, sessionCost: 3000, outcomeNoun: 'purchase' },
  events: { stage: 'step.change', join: 'shopper.enter', leave: 'shopper.abandon', signal: 'support.message', react: 'field.focus', deep: 'offer.accepted', save: 'agent.save', capture: 'capture.frame', nudge: 'nudge.operator' },
  reasons: { collapse: 'hesitation_spiral', idle: 'distraction', hard: 'comparison_shopping' },
  reactions: ['card_field', 'promo_field', 'address_edit', 'qty_change'],
  lines: ['is there a discount code?', 'why is shipping so much?', 'do you deliver to Coimbatore?', 'can I pay in instalments?', 'is this in stock?', 'what is the return window?', 'the promo code is not applying', 'can I change the delivery date?'],
  nudges: {
    burst: (n, st) => `${n} carts abandoned on "${st.label}". This is the shipping-cost cliff - surface the free-shipping threshold above the fold.`,
    cliff: (p, st) => `Intent fell ${p} pts across the cohort. Pre-fill address from the profile and drop a field from the form.`,
  },
  levers: [
    { id: 'ship_upfront', label: 'Show shipping cost on the cart page', hypo: 'The cost is the shock, not the amount. Move it earlier and the cliff flattens.', dropMult: 0.74, focus: 0.045, at: 0, intent: 0.04, cost: 0, transfers: ['webinar'] },
    { id: 'guest_checkout', label: 'Guest checkout by default', hypo: 'Account creation is a wall in front of a purchase nobody asked to justify.', dropMult: 0.85, focus: 0.050, at: 0, intent: 0.03, cost: 0, transfers: ['onboarding'] },
    { id: 'upi_first', label: 'Lead with UPI', hypo: 'One tap beats sixteen fields on mobile, and UPI clears where cards decline.', dropMult: 0.88, focus: 0.035, at: 8, intent: 0.03, cost: 0, transfers: [] },
    { id: 'free_ship_bar', label: 'Free-shipping progress bar', hypo: 'A visible threshold converts the shock into a goal.', dropMult: 0.91, focus: 0.030, at: 0, intent: 0.05, cost: 90, transfers: ['onboarding'] },
    { id: 'exit_offer', label: 'Agent exit-intent offer', hypo: 'When the companion sees hesitation it fires a targeted save before the tab closes.', dropMult: 0.90, focus: 0, at: 2, intent: 0.04, cost: 170, rescue: 0.34, transfers: ['webinar', 'docs'] },
    { id: 'trust_badges', label: 'Payment trust row', hypo: 'Price-checkers need a reason to stop comparing.', dropMult: 0.96, focus: 0.020, at: 8, intent: 0.02, cost: 0, transfers: [] },
  ],
});

/* ═════════════════════════════ 3. onboarding ═════════════════════════════ */

export const onboarding = withDynamics({
  id: 'onboarding',
  leverGain: 0.12,
  outcomeIntent: 0.5,
  label: 'Product onboarding',
  blurb: 'A 21-day trial cohort. The clock is days instead of minutes and nothing else about the model changes.',
  title: 'Self-serve trial cohort — September',
  view: 'funnel',
  operator: 'product', companion: 'companion',
  actorNoun: 'trial', actorPlural: 'trials',
  focusNoun: 'Cohort engagement', signalNoun: 'In-app feedback',
  clock: 'days', stageUnit: 86400, tickSeconds: 43200, horizon: 21, arrivalWindow: 172800,
  cohort: 320,
  segments: {
    champion: { label: 'Champion', weight: 0.14, dropMult: 0.58, intent: 0.70, focus: 0.74, color: '#0d7a4f' },
    team_lead: { label: 'Team lead', weight: 0.24, dropMult: 0.86, intent: 0.46, focus: 0.60, color: '#2563a8' },
    solo_dev: { label: 'Solo dev', weight: 0.38, dropMult: 1.20, intent: 0.24, focus: 0.50, color: '#b0721a' },
    tyre_kicker: { label: 'Tyre-kicker', weight: 0.24, dropMult: 1.70, intent: 0.05, focus: 0.34, color: '#5b4bb8' },
  },
  stages: [
    { id: 'signup', label: 'Signed up', headline: 'Account created, nothing built yet', from: 0, to: 2, drop: 0.030, focus: 0.020, interactive: false },
    { id: 'first_run', label: 'First successful run', headline: 'The aha moment, or the exit', from: 2, to: 6, drop: 0.062, focus: 0.045, interactive: true, reason: 'never_activated' },
    { id: 'integration', label: 'Wired into their stack', headline: 'CI, repo, or data source connected', from: 6, to: 11, drop: 0.048, focus: 0.020, interactive: true },
    { id: 'invite', label: 'Invited a teammate', headline: 'The single strongest retention signal', from: 11, to: 16, drop: 0.030, focus: 0.035, interactive: true },
    { id: 'habit', label: 'Weekly habit', headline: 'Three sessions a week, unprompted', from: 16, to: 21, drop: 0.018, focus: 0.010, interactive: false },
  ],
  economics: { unitValue: 1200, winRate: 0.55, sessionCost: 5000, outcomeNoun: 'activation' },
  events: { stage: 'milestone.change', join: 'trial.start', leave: 'trial.churn', signal: 'feedback.sent', react: 'feature.used', deep: 'checklist.completed', save: 'agent.save', capture: 'capture.frame', nudge: 'nudge.pm' },
  reasons: { collapse: 'value_never_landed', idle: 'went_quiet', hard: 'evaluated_and_passed' },
  reactions: ['ran_job', 'opened_docs', 'created_key', 'invited_user'],
  lines: ['how do I connect this to our CI?', 'the quickstart errors on step 3', 'is there a Terraform provider?', 'we need SSO before we can roll out', 'can I import our existing config?', 'what happens when the trial ends?', 'does this work with a monorepo?'],
  nudges: {
    burst: (n, st) => `${n} trials churned at "${st.label}". They all stalled before a first successful run - trigger the guided setup, not another email.`,
    cliff: (p, st) => `Cohort engagement fell ${p} pts. The ones going quiet never invited anyone; open a shared workspace for them.`,
  },
  levers: [
    { id: 'guided_setup', label: 'Guided first run', hypo: 'Nobody churns after a green run. Get them there inside one session.', dropMult: 0.76, focus: 0.060, at: 0, intent: 0.05, cost: 0, inject: 'Run your first job now?', injectSpan: 2, transfers: ['docs', 'checkout'] },
    { id: 'sample_data', label: 'Ship with sample data', hypo: 'An empty product is an unanswerable question.', dropMult: 0.86, focus: 0.045, at: 0, intent: 0.03, cost: 0, transfers: ['docs'] },
    { id: 'invite_prompt', label: 'Prompt a teammate invite on day 3', hypo: 'A second user in the account roughly halves churn.', dropMult: 0.88, focus: 0.030, at: 3, intent: 0.06, cost: 0, transfers: ['webinar'] },
    { id: 'usage_nudge', label: 'Companion nudges on going quiet', hypo: 'Silence is the leading indicator; reach out on the silence, not the deadline.', dropMult: 0.90, focus: 0, at: 1, intent: 0.04, cost: 240, rescue: 0.34, transfers: ['checkout', 'support'] },
    { id: 'extend_trial', label: 'Auto-extend for active trials', hypo: 'Do not expire someone mid-integration.', dropMult: 0.94, focus: 0.020, at: 14, intent: 0.05, cost: 380, transfers: [] },
  ],
});

/* ══════════════════════════════ 4. support ══════════════════════════════ */

export const support = withDynamics({
  id: 'support',
  leverGain: 0.5,
  outcomeIntent: 0.28,
  label: 'Support queue',
  blurb: 'An eight-hour shift of tickets. Here the actors are work items, not people, and "churn" means escalation.',
  title: 'Support queue — Tuesday shift',
  view: 'lanes',
  operator: 'queue', companion: 'companion',
  actorNoun: 'ticket', actorPlural: 'tickets',
  actorNames: 'item', itemPrefix: 'TKT',
  focusNoun: 'Queue health', signalNoun: 'Customer replies',
  clock: 'hours', stageUnit: 3600, tickSeconds: 600, horizon: 8, arrivalWindow: 7200,
  cohort: 240,
  segments: {
    p1: { label: 'P1 outage', weight: 0.08, dropMult: 2.10, intent: 0.72, focus: 0.55, color: '#b8203f' },
    bug: { label: 'Bug report', weight: 0.30, dropMult: 1.15, intent: 0.44, focus: 0.58, color: '#b0721a' },
    howto: { label: 'How-to', weight: 0.42, dropMult: 0.72, intent: 0.30, focus: 0.68, color: '#2563a8' },
    billing: { label: 'Billing', weight: 0.20, dropMult: 0.90, intent: 0.38, focus: 0.62, color: '#0d7a4f' },
  },
  stages: [
    { id: 'triage', label: 'Triage', headline: 'Unassigned, waiting on a human', from: 0, to: 1.5, drop: 0.0125, focus: -0.020, interactive: false, reason: 'aged_in_triage' },
    { id: 'first_reply', label: 'First response', headline: 'The SLA clock everyone actually watches', from: 1.5, to: 3.5, drop: 0.0085, focus: 0.030, interactive: true },
    { id: 'investigate', label: 'Investigation', headline: 'Repro, logs, engineering hand-off', from: 3.5, to: 6, drop: 0.0075, focus: 0.010, interactive: true },
    { id: 'resolve', label: 'Resolution', headline: 'Fix shipped or workaround accepted', from: 6, to: 8, drop: 0.0035, focus: 0.020, interactive: false },
  ],
  economics: { unitValue: 85, winRate: 1, sessionCost: 1600, outcomeNoun: 'clean resolution' },
  events: { stage: 'queue.stage', join: 'ticket.open', leave: 'ticket.escalate', signal: 'customer.reply', react: 'agent.note', deep: 'macro.applied', save: 'agent.save', capture: 'capture.frame', nudge: 'nudge.lead' },
  reasons: { collapse: 'customer_frustrated', idle: 'aged_untouched', hard: 'escalated_to_eng' },
  reactions: ['internal_note', 'tag_added', 'linked_issue', 'kb_attached'],
  lines: ['any update on this?', 'this is blocking our release', 'the workaround did not help', 'can I get someone on a call?', 'still seeing it on 2.4.1', 'happy to send more logs', 'who owns this now?'],
  nudges: {
    burst: (n, st) => `${n} tickets escalated out of "${st.label}". All aged past first response - pull the two oldest forward before the SLA clock trips.`,
    cliff: (p, st) => `Queue health fell ${p} pts. Three P1s landed in one window; rebalance before the shift handover.`,
  },
  levers: [
    { id: 'auto_triage', label: 'Companion auto-triage on arrival', hypo: 'Most of the ageing happens before a human ever reads it.', dropMult: 0.74, focus: 0.055, at: 0, intent: 0.03, cost: 0, transfers: ['codereview'] },
    { id: 'sla_surface', label: 'Surface the SLA clock in-lane', hypo: 'You cannot beat a deadline you cannot see.', dropMult: 0.86, focus: 0.035, at: 0, intent: 0.02, cost: 0, transfers: ['codereview'] },
    { id: 'kb_suggest', label: 'Suggest a KB article with the first reply', hypo: 'Half the how-to queue self-serves if the answer arrives first.', dropMult: 0.88, focus: 0.040, at: 1.5, intent: 0.04, cost: 0, transfers: ['docs'] },
    { id: 'p1_swarm', label: 'Swarm P1s automatically', hypo: 'P1s poison the whole queue while they sit.', dropMult: 0.90, focus: 0.020, at: 0, intent: 0.05, cost: 95, rescue: 0.30, transfers: [] },
    { id: 'handover_brief', label: 'Companion writes the shift handover', hypo: 'Context lost at handover is the second-largest escalation cause.', dropMult: 0.94, focus: 0.025, at: 4, intent: 0.03, cost: 0, transfers: ['codereview'] },
  ],
});

/* ════════════════════════════ 5. code review ════════════════════════════ */

export const codereview = withDynamics({
  id: 'codereview',
  leverGain: 0.45,
  outcomeIntent: 0.3,
  label: 'Code review pipeline',
  blurb: 'Pull requests over six days. A stalled PR is a churned actor, and review latency is the hazard.',
  title: 'Review pipeline — sprint 34',
  view: 'lanes',
  operator: 'repo', companion: 'companion',
  actorNoun: 'pull request', actorPlural: 'PRs',
  actorNames: 'item', itemPrefix: 'PR',
  focusNoun: 'Pipeline momentum', signalNoun: 'Review comments',
  clock: 'days', stageUnit: 86400, tickSeconds: 21600, horizon: 6, arrivalWindow: 86400,
  cohort: 140,
  segments: {
    tiny: { label: 'Under 50 lines', weight: 0.30, dropMult: 0.55, intent: 0.66, focus: 0.76, color: '#0d7a4f' },
    normal: { label: 'Normal', weight: 0.38, dropMult: 1.00, intent: 0.44, focus: 0.58, color: '#2563a8' },
    large: { label: 'Over 400 lines', weight: 0.22, dropMult: 1.75, intent: 0.24, focus: 0.40, color: '#b0721a' },
    cross_team: { label: 'Cross-team', weight: 0.10, dropMult: 2.05, intent: 0.30, focus: 0.44, color: '#5b4bb8' },
  },
  stages: [
    { id: 'opened', label: 'Opened, awaiting reviewer', headline: 'No reviewer assigned yet', from: 0, to: 1, drop: 0.0140, focus: -0.020, interactive: false, reason: 'no_reviewer_assigned' },
    { id: 'review', label: 'Under review', headline: 'First pass in progress', from: 1, to: 2.5, drop: 0.0230, focus: 0.030, interactive: true },
    { id: 'changes', label: 'Changes requested', headline: 'Back with the author', from: 2.5, to: 4, drop: 0.0250, focus: -0.030, interactive: true, reason: 'author_moved_on' },
    { id: 'approve', label: 'Approved', headline: 'Green, waiting on CI', from: 4, to: 5, drop: 0.0090, focus: 0.040, interactive: false },
    { id: 'merge', label: 'Merged', headline: 'Landed on main', from: 5, to: 6, drop: 0.0030, focus: 0.020, interactive: false },
  ],
  economics: { unitValue: 640, winRate: 1, sessionCost: 6000, outcomeNoun: 'merged PR' },
  events: { stage: 'pipeline.stage', join: 'pr.opened', leave: 'pr.stalled', signal: 'review.comment', react: 'ci.run', deep: 'review.requested', save: 'agent.save', capture: 'capture.frame', nudge: 'nudge.maintainer' },
  reasons: { collapse: 'review_fatigue', idle: 'went_stale', hard: 'superseded' },
  reactions: ['ci_green', 'ci_red', 'rebase', 'force_push'],
  lines: ['can you split this into two PRs?', 'nit: naming', 'this needs a test', 'CI is flaky on windows again', 'who owns this module now?', 'rebased on main', 'why not reuse the existing helper?'],
  nudges: {
    burst: (n, st) => `${n} PRs stalled in "${st.label}". Every one is over 400 lines - the size, not the reviewer, is the bottleneck.`,
    cliff: (p, st) => `Pipeline momentum fell ${p} pts. Reviewer load is on two people; round-robin the next five.`,
  },
  levers: [
    { id: 'auto_assign', label: 'Auto-assign a reviewer on open', hypo: 'Day one is dead time that nothing recovers.', dropMult: 0.72, focus: 0.060, at: 0, intent: 0.04, cost: 0, transfers: ['support'] },
    { id: 'size_gate', label: 'Warn on PRs over 400 lines', hypo: 'Large PRs do not get reviewed slowly, they get reviewed never.', dropMult: 0.80, focus: 0.045, at: 0, intent: 0.05, cost: 0, transfers: [] },
    { id: 'stale_ping', label: 'Companion pings stale PRs', hypo: 'A PR untouched for 48h rarely recovers on its own.', dropMult: 0.88, focus: 0, at: 1, intent: 0.04, cost: 240, rescue: 0.34, transfers: ['support', 'onboarding'] },
    { id: 'review_budget', label: 'Round-robin reviewer load', hypo: 'Two reviewers holding the whole queue is the real latency.', dropMult: 0.90, focus: 0.030, at: 0, intent: 0.03, cost: 0, transfers: ['support'] },
    { id: 'ci_precheck', label: 'Run CI before requesting review', hypo: 'Nobody should burn a review pass on a red build.', dropMult: 0.93, focus: 0.025, at: 0, intent: 0.02, cost: 0, transfers: [] },
  ],
});

/* ═══════════════════════════════ 6. docs ═══════════════════════════════ */

export const docs = withDynamics({
  id: 'docs',
  leverGain: 0.085,
  outcomeIntent: 0.52,
  label: 'Docs & content',
  blurb: 'Readers working through an integration guide. Scroll depth is the focus signal and the bounce is the hazard.',
  title: 'Quickstart guide — /docs/agents',
  view: 'funnel',
  operator: 'site', companion: 'companion',
  actorNoun: 'reader', actorPlural: 'readers',
  focusNoun: 'Reading depth', signalNoun: 'Page feedback',
  clock: 'mmss', stageUnit: 60, tickSeconds: 10, horizon: 18, arrivalWindow: 180,
  cohort: 520,
  segments: {
    integrator: { label: 'Integrating now', weight: 0.20, dropMult: 0.62, intent: 0.64, focus: 0.74, color: '#0d7a4f' },
    evaluator: { label: 'Evaluating', weight: 0.28, dropMult: 0.95, intent: 0.40, focus: 0.58, color: '#2563a8' },
    searcher: { label: 'Landed from search', weight: 0.36, dropMult: 1.55, intent: 0.14, focus: 0.40, color: '#b0721a' },
    debugger: { label: 'Debugging an error', weight: 0.16, dropMult: 1.10, intent: 0.52, focus: 0.66, color: '#5b4bb8' },
  },
  stages: [
    { id: 'landing', label: 'Landed on the page', headline: 'Quickstart — Agents', from: 0, to: 3, drop: 0.0270, focus: -0.010, interactive: false, reason: 'wrong_page' },
    { id: 'quickstart', label: 'Install & first call', headline: 'npm i · your first agent in 12 lines', from: 3, to: 7, drop: 0.0150, focus: 0.045, interactive: true },
    { id: 'config', label: 'Configuration', headline: 'Environment, keys, and limits', from: 7, to: 11, drop: 0.0225, focus: -0.025, interactive: false, reason: 'config_wall' },
    { id: 'api', label: 'API reference', headline: 'Tools, streaming, error codes', from: 11, to: 15, drop: 0.0130, focus: 0.020, interactive: true },
    { id: 'ship', label: 'Shipped a call', headline: 'First successful request from their code', from: 15, to: 18, drop: 0.0070, focus: 0.035, interactive: false },
  ],
  economics: { unitValue: 340, winRate: 0.4, sessionCost: 2400, outcomeNoun: 'integration' },
  events: { stage: 'section.change', join: 'reader.arrive', leave: 'reader.bounce', signal: 'page.feedback', react: 'code.copied', deep: 'sandbox.run', save: 'agent.save', capture: 'capture.frame', nudge: 'nudge.writer' },
  reasons: { collapse: 'lost_the_thread', idle: 'tab_parked', hard: 'found_answer_elsewhere' },
  reactions: ['copy_snippet', 'expand_section', 'open_sandbox', 'toc_jump'],
  lines: ['this snippet does not compile', 'which version is this for?', 'where do I get an API key?', 'the Python example is missing', 'broken link in step 4', 'is there a rate limit?', 'more examples please'],
  nudges: {
    burst: (n, st) => `${n} readers bounced inside "${st.label}". They all left within 20s of the config block - that section is a wall.`,
    cliff: (p, st) => `Reading depth fell ${p} pts. Move the runnable example above the configuration section.`,
  },
  levers: [
    { id: 'runnable_first', label: 'Runnable example above config', hypo: 'Proof before setup. The config wall is what people bounce off.', dropMult: 0.76, focus: 0.055, at: 0, intent: 0.05, cost: 0, transfers: ['webinar', 'onboarding'] },
    { id: 'copy_buttons', label: 'One-click copy on every snippet', hypo: 'Friction per snippet compounds across a long page.', dropMult: 0.90, focus: 0.030, at: 0, intent: 0.02, cost: 0, transfers: [] },
    { id: 'inline_sandbox', label: 'Inline sandbox', hypo: 'Running it on the page removes the whole install step from the funnel.', dropMult: 0.80, focus: 0.060, at: 3, intent: 0.06, cost: 160, inject: 'Run this snippet here?', injectSpan: 1, transfers: ['onboarding'] },
    { id: 'error_router', label: 'Route error-searchers straight to fixes', hypo: 'Debuggers arrive mid-page with a specific error and get a tutorial.', dropMult: 0.88, focus: 0.035, at: 0, intent: 0.04, cost: 0, transfers: ['support'] },
    { id: 'exit_capture', label: 'Companion exit-intent help', hypo: 'Catch the bounce with the answer to what they were stuck on.', dropMult: 0.91, focus: 0, at: 1, intent: 0.03, cost: 105, rescue: 0.34, transfers: ['checkout', 'webinar'] },
  ],
});

/* ══════════════════════════════ registry ══════════════════════════════ */

export const SURFACES = { webinar, checkout, onboarding, support, codereview, docs };
export const SURFACE_LIST = Object.values(SURFACES);
export const surfaceById = id => SURFACES[id];

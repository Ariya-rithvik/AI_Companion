/**
 * Backstage core — a surface-agnostic observation kernel.
 *
 * Every surface Backstage watches turns out to be the same shape underneath:
 * a cohort of actors moves through ordered stages, each stage carries a hazard
 * of dropping out, engagement raises intent, and intent plus survival produce
 * an outcome worth money. A webinar attendee leaving at the pricing slide, a
 * shopper abandoning at the payment step, a trial that never activates, a pull
 * request that stalls in review — one model, six vocabularies.
 *
 * So the kernel knows about actors, stages, hazard, signals and outcomes, and
 * knows nothing about webinars. Each surface pack in ./surfaces supplies the
 * nouns, the stage table, the levers and the economics.
 *
 * Pure ESM. No DOM, no deps. Runs in the browser and in Node.
 */

export const LEVER_GAIN = 0.13;   // default lever strength; a surface may override

/* ------------------------------------------------------------------ rng */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const pad = n => String(n).padStart(2, '0');

/* ---------------------------------------------------------------- clock */

/** Surfaces run on wildly different clocks: 40 minutes, or 14 days. */
export function fmtClock(surface, t) {
  const u = surface.clock ?? 'mmss';
  if (u === 'mmss') return pad(Math.floor(t / 60)) + ':' + pad(Math.floor(t % 60));
  if (u === 'hours') return 'H+' + (t / 3600).toFixed(1);
  if (u === 'days') return 'Day ' + (1 + Math.floor(t / 86400));
  return String(t);
}

export const stageAt = (pos, stages) =>
  stages.find(s => pos >= s.from && pos < s.to) ?? stages[stages.length - 1];

/* --------------------------------------------------------------- levers */

export const leverById = (surface, id) => surface.levers.find(l => l.id === id);

/** Apply global gain and stacking damping. Levers never stack for free. */
function prepareLevers(surface, ids) {
  const gain = surface.leverGain ?? LEVER_GAIN;
  return ids
    .map(l => (typeof l === 'string' ? leverById(surface, l) : l))
    .filter(Boolean)
    .map((l, i) => {
      const g = gain * Math.pow(0.86, i);
      return {
        ...l,
        dropMult: 1 - (1 - (l.dropMult ?? 1)) * g,
        focus: (l.focus ?? 0) * g,
        intent: (l.intent ?? 0) * g,
        rescue: l.rescue ? l.rescue * g : undefined,
      };
    });
}

/* --------------------------------------------------------------- actors */

const FIRST = ['Aarav', 'Mei', 'Jonas', 'Priya', 'Tomas', 'Lena', 'Kofi', 'Sara', 'Diego', 'Yuki', 'Noor', 'Ines', 'Rahul', 'Elif', 'Marcus', 'Anya', 'Hugo', 'Zara', 'Ivan', 'Nadia', 'Oskar', 'Leila', 'Sam', 'Rin', 'Bilal', 'Freya', 'Tariq', 'Isla', 'Kenji', 'Mira'];
const LAST = ['Rao', 'Chen', 'Berg', 'Nair', 'Silva', 'Kovac', 'Mensah', 'Haddad', 'Ortiz', 'Tanaka', 'Aziz', 'Costa', 'Iyer', 'Demir', 'Wolfe', 'Petrov', 'Lima', 'Khan', 'Novak', 'Farah', 'Lind', 'Saab', 'Reid', 'Sato', 'Amin', 'Holm', 'Bakri', 'Moore', 'Ito', 'Shah'];

/** Some surfaces track people, others track work items. Both are actors. */
function nameFor(surface, rnd, i) {
  if (surface.actorNames === 'item') return surface.itemPrefix + '-' + (100 + i);
  return pick(rnd, FIRST) + ' ' + pick(rnd, LAST)[0] + '.';
}

/* -------------------------------------------------------------- session */

let _seq = 0;

export function createSession({ surface, seed = 7, cohort, levers = [], title, live = false } = {}) {
  if (!surface) throw new Error('createSession needs a surface pack');
  const rnd = mulberry32(seed);
  const stacked = prepareLevers(surface, levers);

  let stages = surface.stages;
  for (const l of stacked) {
    if (l.reshape) stages = l.reshape(stages.map(s => ({ ...s })));
  }

  const n = cohort ?? surface.cohort;
  const keys = Object.keys(surface.segments);
  const roster = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    let segment = keys[keys.length - 1];
    let acc = 0;
    for (const k of keys) { acc += surface.segments[k].weight; if (r <= acc) { segment = k; break; } }
    const sg = surface.segments[segment];
    roster.push({
      id: 'a_' + pad(i),
      name: nameFor(surface, rnd, i),
      segment,
      joinedAt: Math.floor(rnd() * surface.arrivalWindow),
      leftAt: null,
      leaveReason: null,
      focus: Math.max(0.12, Math.min(0.97, sg.focus + (rnd() - 0.5) * 0.28)),
      intent: Math.max(0, Math.min(1, sg.intent + (rnd() - 0.5) * 0.2)),
      msgs: 0, reactions: 0, deep: 0, saves: 0,
      lastInteraction: 0,
    });
  }

  return {
    id: 'ses_' + Date.now().toString(36) + '_' + (_seq++).toString(36),
    surface, surfaceId: surface.id,
    title: title ?? surface.title,
    seed, rnd, stages, levers: stacked, live,
    t: 0, roster, dataset: [], moments: [], nudges: [], signals: [],
    peak: 0, stageId: stages[0].id, done: false,
    _leaveWindow: [], _focusHistory: [],
  };
}

const activeOf = s => s.roster.filter(a => a.joinedAt <= s.t && a.leftAt === null);
const arrivedOf = s => s.roster.filter(a => a.joinedAt <= s.t);

/** Mean focus across everyone still present. The room's pulse. */
export function focusOf(s) {
  const a = activeOf(s);
  return a.length ? a.reduce((x, y) => x + y.focus, 0) / a.length : 0;
}

/** Position on the surface's own clock (minutes, hours, days...). */
const posOf = s => s.t / s.surface.stageUnit;

/* ----------------------------------------------------------- dataset row */

function emit(s, type, actor, payload, extra = {}) {
  const st = stageAt(posOf(s), s.stages);
  const act = activeOf(s);
  const row = {
    seq: s.dataset.length,
    t: s.t,
    ts: fmtClock(s.surface, s.t),
    session_id: s.id,
    surface: s.surfaceId,
    type,
    actor,
    stage: st.id,
    payload,
    features: {
      stage_idx: s.stages.indexOf(st),
      cohort_focus: +focusOf(s).toFixed(4),
      cohort_retention: +(act.length / Math.max(1, s.peak)).toFixed(4),
      concurrent: act.length,
      position: +posOf(s).toFixed(2),
      interactive_stage: st.interactive ? 1 : 0,
      levers: s.levers.map(l => l.id),
      ...(extra.features || {}),
    },
    label: { churn_next: null, outcome: null, ...(extra.label || {}) },
  };
  s.dataset.push(row);
  return row;
}

/* ------------------------------------------------------------------ tick */

export function tick(s) {
  if (s.done) return [];
  const sf = s.surface;
  const out = [];
  const rnd = s.rnd;
  const prev = s.stageId;
  const pos = posOf(s);
  const st = stageAt(pos, s.stages);
  const ev = sf.events;

  if (st.id !== prev) {
    s.stageId = st.id;
    out.push(emit(s, ev.stage, sf.operator, { stage: st.id, headline: st.headline, label: st.label }));
    out.push(capture(s, 'chapter', st.label, st.headline));
  }

  for (const a of s.roster) {
    if (a.leftAt === null && a.joinedAt > s.t - sf.tickSeconds && a.joinedAt <= s.t) {
      out.push(emit(s, ev.join, a.id, { name: a.name, segment: a.segment }));
    }
  }
  s.peak = Math.max(s.peak, activeOf(s).length);

  const lFocus = s.levers.filter(l => pos >= l.at).reduce((x, l) => x + l.focus, 0);
  const lDrop = s.levers.filter(l => pos >= l.at).reduce((x, l) => x * l.dropMult, 1);
  const lIntent = s.levers.filter(l => pos >= l.at).reduce((x, l) => x + l.intent, 0);
  const rescue = s.levers.find(l => l.rescue && pos >= l.at);
  const span = (sf.horizon * sf.stageUnit) / sf.tickSeconds;   // ticks in a whole run
  let leavesThisTick = 0;

  for (const a of activeOf(s)) {
    const sg = sf.segments[a.segment];
    const idle = (s.t - a.lastInteraction) / sf.stageUnit;
    const fatigue = sf.fatigue * Math.min(idle, sf.idleCap) + sf.drift * pos;

    a.focus += (st.focus / 8) + (lFocus / 40) - fatigue + (rnd() - 0.5) * 0.045;

    if (rescue && a.focus < 0.30 && rnd() < rescue.rescue / 4) {
      a.focus += 0.26; a.saves++; a.lastInteraction = s.t;
      out.push(emit(s, ev.save, a.id, { tactic: rescue.id, segment: a.segment },
        { features: { focus: +a.focus.toFixed(3) } }));
    }
    a.focus = Math.max(0.02, Math.min(1, a.focus));
    a.intent = Math.min(1, a.intent + 0.0012 * (a.focus - 0.45) + lIntent / span);

    // engagement signals
    if (st.interactive && rnd() < (0.012 + a.focus * 0.03) * (st.signalMult ?? 1)) {
      a.msgs++; a.lastInteraction = s.t;
      a.intent = Math.min(1, a.intent + 0.02);
      const text = pick(rnd, sf.lines);
      s.signals.push({ t: s.t, name: a.name, text, segment: a.segment });
      if (s.signals.length > 60) s.signals.shift();
      out.push(emit(s, ev.signal, a.id, { text, segment: a.segment }));
    }
    if (rnd() < 0.006 + a.focus * 0.012) {
      a.reactions++; a.lastInteraction = s.t;
      out.push(emit(s, ev.react, a.id, { kind: pick(rnd, sf.reactions) }));
    }
    // a lever may inject its own interaction (a poll, a nudge email, a prompt)
    const inject = s.levers.find(l => l.inject && pos >= l.at && pos < l.at + l.injectSpan);
    if (inject && a.deep === 0 && rnd() < 0.45) {
      a.deep++; a.lastInteraction = s.t;
      a.focus += inject.focus * 1.5;
      a.intent = Math.min(1, a.intent + inject.intent * 1.5);
      out.push(emit(s, ev.deep, a.id, { prompt: inject.inject }));
    }

    const hazard = st.drop * sg.dropMult * (1.38 - a.focus) * lDrop * (0.75 + Math.min(idle, sf.idleCap) * 0.045);
    if (rnd() < hazard) {
      a.leftAt = s.t;
      a.leaveReason = a.focus < 0.28 ? sf.reasons.collapse
        : st.reason ?? (idle > sf.idleCap / 2 ? sf.reasons.idle : sf.reasons.hard);
      leavesThisTick++;
      out.push(emit(s, ev.leave, a.id, {
        name: a.name, segment: a.segment, reason: a.leaveReason, dwell_s: s.t - a.joinedAt,
      }, {
        features: {
          focus: +a.focus.toFixed(3), intent: +a.intent.toFixed(3), segment: a.segment,
          tenure_s: s.t - a.joinedAt, msgs: a.msgs, reactions: a.reactions, deep: a.deep,
          since_interaction_s: s.t - a.lastInteraction,
        },
        label: { churn_next: 1 },
      }));
    }
  }

  /* ---- moment detection: what the companion actually notices ---- */
  s._leaveWindow.push(leavesThisTick);
  if (s._leaveWindow.length > 4) s._leaveWindow.shift();
  const burst = s._leaveWindow.reduce((a, b) => a + b, 0);
  if (burst >= sf.burstThreshold && s.t > sf.tickSeconds * 4) {
    out.push(capture(s, 'dropoff_burst', `${burst} ${sf.actorPlural} left during "${st.label}"`, st.headline));
    out.push(nudge(s, 'high', sf.nudges.burst(burst, st)));
    s._leaveWindow = [];
  }

  const f = focusOf(s);
  s._focusHistory.push(f);
  if (s._focusHistory.length > 8) s._focusHistory.shift();
  if (s._focusHistory.length === 8 && s._focusHistory[0] - f > 0.075) {
    const pts = ((s._focusHistory[0] - f) * 100).toFixed(0);
    out.push(capture(s, 'focus_cliff', `${sf.focusNoun} fell ${pts} pts`, st.headline));
    out.push(nudge(s, 'medium', sf.nudges.cliff(pts, st)));
    s._focusHistory = [];
  }

  s.t += sf.tickSeconds;
  // Re-check the peak after the clock moves: actors whose joinedAt falls inside
  // the tick we just closed are only "present" at the new t, and without this
  // the live retention gauge reads over 100% while a cohort is still arriving.
  s.peak = Math.max(s.peak, activeOf(s).length);
  if (s.t >= sf.horizon * sf.stageUnit) { s.done = true; finalize(s); }
  return out;
}

function capture(s, kind, caption, headline) {
  const m = { id: 'cap_' + s.moments.length, t: s.t, ts: fmtClock(s.surface, s.t), kind, caption, headline, stage: s.stageId };
  s.moments.push(m);
  return emit(s, s.surface.events.capture, s.surface.companion, m);
}

function nudge(s, urgency, text) {
  const n = { id: 'nud_' + s.nudges.length, t: s.t, ts: fmtClock(s.surface, s.t), urgency, text, stage: s.stageId, acted: false };
  s.nudges.push(n);
  return emit(s, s.surface.events.nudge, s.surface.companion, n);
}

/** Back-fill labels once the run closes. This is what makes the file trainable. */
function finalize(s) {
  const leaveAt = new Map(s.roster.map(a => [a.id, a.leftAt]));
  const window = s.surface.churnWindow * s.surface.stageUnit;
  for (const row of s.dataset) {
    if (!leaveAt.has(row.actor)) continue;
    const lt = leaveAt.get(row.actor);
    row.label.churn_next = lt !== null && lt - row.t <= window && lt >= row.t ? 1 : 0;
    const a = s.roster.find(x => x.id === row.actor);
    row.label.outcome = a && outcomeScore(s.surface, a, s) >= 0.5 ? 1 : 0;
  }
}

/* -------------------------------------------------------------- outcomes */

/**
 * Expected-outcome propensity. Deliberately smooth rather than a hard cut-off:
 * a threshold makes a +0.03 intent nudge flip whole cohorts at once, which
 * turns every experiment into a cliff. This keeps lift proportional to effect.
 */
export function outcomeScore(surface, a, s) {
  const e = Math.min(1, (a.msgs * 1 + a.deep * 0.7 + a.reactions * 0.3 + a.saves * 0.5) / 2.5);
  const gate = surface.outcomeGate * surface.stageUnit;
  const runway = (surface.horizon - surface.outcomeGate) * surface.stageUnit;
  const survived = a.leftAt === null ? 1 : Math.max(0, Math.min(1, (a.leftAt - gate) / Math.max(1, runway * 0.6)));
  const p = 1 / (1 + Math.exp(-6.2 * (a.intent - surface.outcomeIntent)));
  return p * (0.35 + 0.65 * e) * survived;
}

export const isConverted = (surface, a, s) => outcomeScore(surface, a, s) >= 0.5;

/* --------------------------------------------------------------- metrics */

export function metricsOf(s) {
  const sf = s.surface;
  const arrived = arrivedOf(s).length || 1;
  const stayed = s.roster.filter(a => a.leftAt === null).length;
  const dwell = s.roster.reduce((x, a) => x + ((a.leftAt === null ? s.t : a.leftAt) - a.joinedAt), 0) / arrived;
  const outcomes = Math.round(s.roster.reduce((x, a) => x + outcomeScore(sf, a, s), 0));
  const revenue = outcomes * sf.economics.winRate * sf.economics.unitValue;
  const cost = sf.economics.sessionCost + s.levers.reduce((x, l) => x + (l.cost || 0), 0);
  return {
    cohort: s.roster.length,
    arrived,
    peak: s.peak,
    stayed,
    retention: +(stayed / arrived).toFixed(4),
    avg_dwell: +(dwell / sf.stageUnit).toFixed(2),
    outcomes,
    outcome_rate: +(outcomes / arrived).toFixed(4),
    pipeline: Math.round(outcomes * sf.economics.unitValue),
    revenue: Math.round(revenue),
    cost: Math.round(cost),
    roi: +((revenue - cost) / cost).toFixed(3),
    rows: s.dataset.length,
    moments: s.moments.length,
  };
}

export function runSession(opts = {}) {
  const s = createSession(opts);
  while (!s.done) tick(s);
  return { session: s, metrics: metricsOf(s) };
}

/* ----------------------------------------------------------- monte carlo */

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const quant = (a, q) => {
  const b = [...a].sort((x, y) => x - y);
  return b[Math.max(0, Math.min(b.length - 1, Math.floor(q * b.length)))];
};

/**
 * Percentile bootstrap for a 90% interval around the *mean* lift.
 *
 * The spread of individual runs is a prediction interval - it says how much any
 * one session varies, and it does not shrink as you add runs. Gating promotion
 * on that is wrong twice over: it rejects real effects, and it makes the "runs"
 * control decorative. What the promotion gate needs is the uncertainty in the
 * estimate, which is what this returns.
 */
function bootstrapCI(vals, draws = 600, rnd = mulberry32(0x5eed)) {
  const n = vals.length;
  const means = new Array(draws);
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += vals[(rnd() * n) | 0];
    means[d] = sum / n;
  }
  return [quant(means, 0.05), quant(means, 0.95)];
}

export function runMonteCarlo({ surface, levers = [], n = 120, seed = 1, cohort } = {}) {
  const base = [], vari = [];
  for (let i = 0; i < n; i++) {
    const sd = seed + i * 17;
    base.push(metricsOf(runSession({ surface, seed: sd, cohort, levers: [] }).session));
    vari.push(metricsOf(runSession({ surface, seed: sd, cohort, levers }).session));
  }
  const cmp = key => {
    const b = base.map(m => m[key]);
    const v = vari.map(m => m[key]);
    const lifts = b.map((x, i) => (x === 0 ? 0 : (v[i] - x) / Math.abs(x)));
    const ci = bootstrapCI(lifts);
    return {
      baseline: +mean(b).toFixed(3),
      variant: +mean(v).toFixed(3),
      lift_pct: +(mean(lifts) * 100).toFixed(2),
      ci90: [+(ci[0] * 100).toFixed(2), +(ci[1] * 100).toFixed(2)],
      spread90: [+(quant(lifts, 0.05) * 100).toFixed(2), +(quant(lifts, 0.95) * 100).toFixed(2)],
    };
  };
  const roi = cmp('roi');
  return {
    n,
    surface: surface.id,
    levers: levers.map(l => (typeof l === 'string' ? l : l.id)),
    metrics: {
      retention: cmp('retention'), avg_dwell: cmp('avg_dwell'),
      outcomes: cmp('outcomes'), pipeline: cmp('pipeline'), roi,
    },
    significant: roi.ci90[0] > 0,
    verdict: roi.ci90[0] > 0 ? (roi.lift_pct > 8 ? 'promote' : 'keep') : 'reject',
  };
}

/* ------------------------------------------------------------------ skill */

export function skillFromExperiment(surface, exp) {
  const defs = exp.levers.map(id => leverById(surface, id)).filter(Boolean);
  return {
    id: 'skill_' + surface.id + ':' + exp.levers.join('+'),
    surface: surface.id,
    name: defs.map(d => d.label).join(' + '),
    trigger: defs[0] ? `${surface.id}.position >= ${defs[0].at}` : `${surface.id}.start`,
    action: exp.levers,
    hypothesis: defs.map(d => d.hypo).join(' '),
    transfers: [...new Set(defs.flatMap(d => d.transfers ?? []))],
    evidence: {
      simulations: exp.n,
      roi_lift_pct: exp.metrics.roi.lift_pct,
      ci90: exp.metrics.roi.ci90,
      retention_lift_pct: exp.metrics.retention.lift_pct,
      outcome_lift_pct: exp.metrics.outcomes.lift_pct,
    },
    promoted_at: new Date().toISOString(),
    times_applied: 0,
    armed: true,
  };
}

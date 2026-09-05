/**
 * Backstage memory — what the companion carries between sessions.
 *
 * A dashboard tells you what is happening now. A companion remembers what
 * happened last time and warns you *before* it happens again. That is the whole
 * difference, and it is this file.
 *
 * The loop:
 *   1. remember(session)      a finished run is compressed into one episode
 *   2. consolidate(surface)   episodes are mined for patterns that RECUR
 *   3. cuesFor(...)           during the next run, a pattern fires as a timed cue
 *   4. reinforce / contradict the next episode either confirms the pattern or not
 *
 * Honesty rules, enforced in code rather than described:
 *   - a pattern needs MIN_EPISODES before it exists at all; below that the UI
 *     shows "watching, 1 of 3" instead of a confident-sounding sentence
 *   - every pattern carries the episode ids it was derived from, so any claim
 *     can be traced back to the runs that produced it
 *   - a pattern that stops reproducing loses confidence and stops firing; memory
 *     that only accumulates and never forgets becomes superstition
 *
 * Pure ESM, no deps. Storage is pluggable so the same code runs against
 * localStorage in the browser and a JSON file in Node.
 */

export const MIN_EPISODES = 3;      // below this, no pattern is asserted
export const MAX_EPISODES = 40;     // ring buffer per surface
export const MAX_QUESTION_CUES = 2; // more than this at one moment is noise
const HALF_LIFE = 12;               // episodes after which unreinforced confidence halves

/* ─────────────────────────────── storage ─────────────────────────────── */

const memoryStore = () => {
  if (typeof localStorage !== 'undefined') {
    return {
      read: () => { try { return JSON.parse(localStorage.getItem('backstage.memory.v1') || 'null'); } catch { return null; } },
      write: v => { try { localStorage.setItem('backstage.memory.v1', JSON.stringify(v)); } catch { /* quota or private mode */ } },
    };
  }
  return { _v: null, read() { return this._v; }, write(v) { this._v = v; } };
};

let adapter = memoryStore();
export const setAdapter = a => { adapter = a; };

const blank = () => ({ version: 1, episodes: [], patterns: [], updated: null });

export function load() {
  const m = adapter.read();
  if (!m || m.version !== 1) return blank();
  return m;
}
export function save(m) { m.updated = new Date().toISOString(); adapter.write(m); return m; }
export function reset() { return save(blank()); }

/* ───────────────────────────── episodes ───────────────────────────── */

/**
 * Compress a finished session into the handful of facts worth carrying forward.
 * Deliberately small: memory that stores everything is a database, not a memory,
 * and it cannot be reasoned over cheaply on the next run.
 */
export function episodeOf(session, metricsOf, stageUnit) {
  const u = stageUnit ?? session.surface.stageUnit;
  const m = metricsOf(session);

  // where people actually went, bucketed by the stage they were in when they left
  const byStage = {};
  for (const a of session.roster) {
    if (a.leftAt === null) continue;
    const st = session.stages.find(s => a.leftAt / u >= s.from && a.leftAt / u < s.to) ?? session.stages[session.stages.length - 1];
    const b = (byStage[st.id] ??= { stage: st.id, label: st.label, count: 0, reasons: {}, positions: [] });
    b.count++;
    b.reasons[a.leaveReason] = (b.reasons[a.leaveReason] ?? 0) + 1;
    b.positions.push(a.leftAt / u);
  }
  const losses = Object.values(byStage)
    .map(b => ({
      stage: b.stage, label: b.label, count: b.count,
      topReason: Object.entries(b.reasons).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      medianPosition: +median(b.positions).toFixed(2),
    }))
    .sort((x, y) => y.count - x.count);

  // the questions nobody answered, as raw text - the phrasing matters later
  const asks = {};
  for (const s of session.signals) asks[s.text] = (asks[s.text] ?? 0) + 1;
  const topAsks = Object.entries(asks).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([text, n]) => ({ text, n }));

  return {
    id: session.id,
    surface: session.surfaceId,
    at: new Date().toISOString(),
    armed: session.levers.map(l => l.id),
    metrics: { retention: m.retention, outcomes: m.outcomes, roi: m.roi, peak: m.peak, rows: m.rows },
    losses: losses.slice(0, 4),
    topAsks,
    nudges: session.nudges.length,
  };
}

const median = a => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2;
};
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function remember(session, metricsOf) {
  const m = load();
  const ep = episodeOf(session, metricsOf);
  m.episodes = m.episodes.filter(e => e.id !== ep.id);
  m.episodes.push(ep);
  const perSurface = m.episodes.filter(e => e.surface === ep.surface);
  if (perSurface.length > MAX_EPISODES) {
    const drop = perSurface.slice(0, perSurface.length - MAX_EPISODES).map(e => e.id);
    m.episodes = m.episodes.filter(e => !drop.includes(e.id));
  }
  consolidateInto(m, ep.surface);
  save(m);
  return ep;
}

export const episodesFor = (m, surface) => m.episodes.filter(e => e.surface === surface);

/* ──────────────────────────── consolidation ────────────────────────────
 * Turn a pile of episodes into claims that RECUR. A thing that happened once
 * is an anecdote; this only promotes what keeps happening, and records how
 * often it did so the UI can show the denominator.
 * ─────────────────────────────────────────────────────────────────────── */

function consolidateInto(m, surface) {
  const eps = episodesFor(m, surface);
  const others = m.patterns.filter(p => p.surface !== surface);
  const prev = m.patterns.filter(p => p.surface === surface);
  const found = [];

  if (eps.length >= MIN_EPISODES) {
    /* 1. loss hotspot — the stage that tops the departure list most often */
    const tally = {};
    for (const e of eps) {
      const top = e.losses[0];
      if (!top) continue;
      (tally[top.stage] ??= { stage: top.stage, label: top.label, hits: 0, counts: [], positions: [], reasons: {}, eps: [] });
      const t = tally[top.stage];
      t.hits++; t.counts.push(top.count); t.positions.push(top.medianPosition); t.eps.push(e.id);
      if (top.topReason) t.reasons[top.topReason] = (t.reasons[top.topReason] ?? 0) + 1;
    }
    for (const t of Object.values(tally)) {
      const share = t.hits / eps.length;
      if (share < 0.5) continue;                       // must be the usual case, not one bad run
      const reason = Object.entries(t.reasons).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
      found.push({
        id: `pat:${surface}:loss:${t.stage}`,
        surface, kind: 'loss_hotspot',
        statement: `"${t.label}" is where you lose the most people`,
        detail: `${Math.round(avg(t.counts))} on average, usually around ${avg(t.positions).toFixed(1)}${unitOf(surface)}${reason ? `, mostly ${reason.replace(/_/g, ' ')}` : ''}.`,
        where: { stage: t.stage, label: t.label, position: +avg(t.positions).toFixed(2) },
        evidence: { episodes: t.eps, n: t.hits, of: eps.length, share: +share.toFixed(2), meanCount: Math.round(avg(t.counts)) },
      });
    }

    /* 2. recurring question — the same thing asked run after run */
    const askTally = {};
    for (const e of eps) {
      for (const a of e.topAsks) {
        (askTally[a.text] ??= { text: a.text, hits: 0, eps: [] });
        askTally[a.text].hits++;
        askTally[a.text].eps.push(e.id);
      }
    }
    for (const a of Object.values(askTally)) {
      const share = a.hits / eps.length;
      if (share < 0.6) continue;
      found.push({
        id: `pat:${surface}:ask:${hash(a.text)}`,
        surface, kind: 'recurring_question', ask: a.text,
        statement: `They keep asking: "${a.text}"`,
        detail: `Raised in ${a.hits} of the last ${eps.length} runs. Answer it before they have to ask.`,
        where: { stage: null, position: null },
        evidence: { episodes: a.eps, n: a.hits, of: eps.length, share: +share.toFixed(2) },
      });
    }

    /* 3. what actually helped — split episodes by whether a skill was armed */
    const leverIds = [...new Set(eps.flatMap(e => e.armed))];
    for (const lev of leverIds) {
      const withL = eps.filter(e => e.armed.includes(lev));
      const without = eps.filter(e => !e.armed.includes(lev));
      if (withL.length < 2 || without.length < 2) continue;   // needs both sides
      const dRet = avg(withL.map(e => e.metrics.retention)) - avg(without.map(e => e.metrics.retention));
      if (Math.abs(dRet) < 0.02) continue;
      found.push({
        id: `pat:${surface}:lever:${lev}`,
        surface, kind: 'observed_effect',
        statement: `Runs with "${lev}" armed ${dRet > 0 ? 'held' : 'lost'} ${Math.abs(dRet * 100).toFixed(1)} more points of retention`,
        detail: `${withL.length} runs with it vs ${without.length} without. Observed, not randomised — treat as a hint, not a result.`,
        where: { stage: null, position: null },
        evidence: { episodes: [...withL, ...without].map(e => e.id), n: withL.length, of: eps.length, share: 1, delta: +dRet.toFixed(4) },
        observational: true,
      });
    }
  }

  /* merge with what we already believed: reinforce, contradict, decay */
  const merged = found.map(f => {
    const old = prev.find(p => p.id === f.id);
    const confirmed = (old?.confirmed ?? 0) + 1;
    const contradicted = old?.contradicted ?? 0;
    return {
      ...f,
      firstSeen: old?.firstSeen ?? new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      confirmed, contradicted,
      confidence: confidenceOf(f.evidence, confirmed, contradicted),
      muted: old?.muted ?? false,
    };
  });

  // a belief that stopped reproducing decays rather than vanishing silently
  for (const p of prev) {
    if (merged.some(x => x.id === p.id)) continue;
    const contradicted = (p.contradicted ?? 0) + 1;
    const confidence = confidenceOf(p.evidence, p.confirmed ?? 1, contradicted);
    if (confidence < 0.15) continue;                    // forgotten
    merged.push({ ...p, contradicted, confidence, stale: true });
  }

  m.patterns = [...others, ...merged.sort((a, b) => b.confidence - a.confidence)];
  return m;
}

export function consolidate(surface) { const m = load(); consolidateInto(m, surface); return save(m); }

function confidenceOf(ev, confirmed, contradicted) {
  const volume = 1 - Math.exp(-(ev.n ?? 1) / 3);        // more supporting runs -> firmer
  const decay = Math.pow(0.5, contradicted / HALF_LIFE);
  return +Math.max(0, Math.min(1, (ev.share ?? 1) * volume * decay)).toFixed(3);
}

/** Deterministic per-pattern stagger, so two question cues never collide. */
const questionOffset = (p, horizon) => (parseInt(p.id.slice(-2), 36) % 3) * horizon * 0.05;

const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36).slice(0, 6); };
const unitOf = surface => (surface === 'onboarding' || surface === 'codereview' ? 'd' : surface === 'support' ? 'h' : 'min');

/* ─────────────────────────────── cues ───────────────────────────────
 * A pattern becomes useful only when it arrives at the right moment. A cue is
 * a pattern plus a firing position, placed EARLY enough to act on.
 * ────────────────────────────────────────────────────────────────────── */

export function cuesFor(surface, horizon, stages) {
  const m = load();
  const lead = horizon * 0.08;                          // fire ~8% of the run ahead of the event

  // Questions do not arrive at minute zero. Place those cues at the first stage
  // where people can actually speak, and stagger them - three cues landing on
  // the host in the same second is noise, not help.
  const firstInteractive = stages?.find(x => x.interactive)?.from ?? 0;
  let asked = 0;

  return m.patterns
    .filter(p => p.surface === surface && !p.muted && p.confidence >= 0.3)
    .sort((a, b) => b.confidence - a.confidence)
    .filter(p => (p.kind === 'recurring_question' ? asked++ < MAX_QUESTION_CUES : true))
    .map(p => {
      const at = p.where?.position != null
        ? Math.max(0, p.where.position - lead)
        : Math.max(0, firstInteractive - lead) + questionOffset(p, horizon);
      return {
        id: 'cue:' + p.id,
        patternId: p.id,
        kind: p.kind,
        at,
        stage: p.where?.stage ?? null,
        say: sayFor(p),
        why: `${p.evidence.n} of the last ${p.evidence.of} runs`,
        confidence: p.confidence,
        observational: !!p.observational,
      };
    })
    .sort((a, b) => a.at - b.at);
}

/**
 * Deterministic phrasing, composed from the pattern's fields rather than by
 * editing its statement string - string surgery on prose is how a stray quote
 * ends up in front of a host mid-meeting.
 * phraseCuesWithLLM() upgrades this wording when a model is wired.
 */
function sayFor(p) {
  if (p.kind === 'loss_hotspot') {
    return `"${p.where.label}" is coming up. It has cost you ${p.evidence.meanCount} people on average — break it up before you get there.`;
  }
  if (p.kind === 'recurring_question') {
    return `Answer this before they ask: ${p.ask ? `"${p.ask}"` : p.statement}`;
  }
  return `${p.statement}. ${p.detail}`;
}

/**
 * Optional LLM pass. Rewrites cue text into something a host can act on in ten
 * seconds, without inventing anything: the model may only rephrase the facts it
 * is given, and any cue whose numbers change is discarded by the caller.
 */
export async function phraseCuesWithLLM(cues, surface, callModel) {
  if (!callModel || !cues.length) return cues;
  try {
    const out = await callModel({
      system: 'You rewrite operator cues. You may only rephrase the facts given. Never add a number, a name, or a claim that is not in the input. Each rewrite must be one sentence a host can act on within ten seconds. Return JSON: {"cues":[{"id":"...","say":"..."}]}.',
      user: JSON.stringify(cues.map(c => ({ id: c.id, fact: c.say, evidence: c.why, surface }))),
    });
    const parsed = typeof out === 'string' ? JSON.parse(out) : out;
    const byId = Object.fromEntries((parsed.cues ?? []).map(c => [c.id, c.say]));
    return cues.map(c => (byId[c.id] ? { ...c, say: byId[c.id], phrasedBy: 'llm' } : c));
  } catch {
    return cues;                                        // phrasing is a nicety; never fail the run for it
  }
}

/* ─────────────────────────────── briefing ─────────────────────────────── */

/** What the companion tells you BEFORE the next run starts. */
export function brief(surface, horizon, stages) {
  const m = load();
  const eps = episodesFor(m, surface);
  const cues = cuesFor(surface, horizon, stages);
  const pats = m.patterns.filter(p => p.surface === surface && !p.muted);

  if (eps.length < MIN_EPISODES) {
    return {
      ready: false,
      episodes: eps.length,
      needed: MIN_EPISODES,
      message: `Watching. ${eps.length} of ${MIN_EPISODES} runs recorded — nothing is asserted until a thing happens three times.`,
      cues: [], patterns: pats,
    };
  }
  return {
    ready: true,
    episodes: eps.length,
    message: `${pats.length} pattern${pats.length === 1 ? '' : 's'} from your last ${eps.length} runs. ${cues.length} will fire during this one.`,
    trend: trendOf(eps),
    cues, patterns: pats,
  };
}

function trendOf(eps) {
  const recent = eps.slice(-3), older = eps.slice(0, -3);
  if (!older.length) return null;
  const d = avg(recent.map(e => e.metrics.retention)) - avg(older.map(e => e.metrics.retention));
  return { retention_delta: +d.toFixed(4), recent: recent.length, older: older.length };
}

export function forget(patternId) {
  const m = load();
  const p = m.patterns.find(x => x.id === patternId);
  if (p) p.muted = true;
  return save(m);
}

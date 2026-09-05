import * as E from '../engine/core.mjs';
import { SURFACE_LIST, surfaceById } from '../engine/surfaces.mjs';
import { seedLibrary } from '../engine/library.mjs';
import * as M from '../engine/memory.mjs';
import { mountCompanion } from './companion.js';

/* ══════════════════════════════════ state ══════════════════════════════════ */

const S = {
  surfaceId: 'webinar',
  ses: null,
  timer: null,
  speed: 4,
  anon: true,
  focusHist: [],
  ticker: [],
  experiments: [],
  rpc: [],
  remote: false,          // true once the Web MCP server answers
  serverTools: null,      // catalogue as reported by tools/list
  skills: seedLibrary(),
  cues: [],              // memory-derived cues armed for the current run
  fired: new Set(),      // cue ids already surfaced this run
};

const sf = () => surfaceById(S.surfaceId);

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pct = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const hue = str => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

const skillsHere = () => S.skills.filter(k => k.surface === S.surfaceId);
const armedLevers = () => skillsHere().filter(k => k.armed).flatMap(k => k.action);

/* ═════════════════════════════ MCP client shim ═════════════════════════════
 * Every action in this UI goes through one call path. If the Web MCP server is
 * reachable the call really is JSON-RPC over HTTP; if the page was opened
 * standalone the same tool runs against the in-page engine. Either way it is
 * logged, so the MCP tab shows actual traffic and not a mock-up.
 * ═════════════════════════════════════════════════════════════════════════ */

let rpcId = 0;

async function mcp(tool, args = {}) {
  const id = ++rpcId;
  const t0 = performance.now();
  const withSurface = { surface: S.surfaceId, ...args };
  let result, mode = 'local';

  if (S.remote) {
    try {
      const r = await fetch('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: withSurface } }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      result = JSON.parse(j.result.content[0].text);
      mode = 'remote';
    } catch {
      S.remote = false;
      result = localTool(tool, withSurface);
    }
  } else {
    result = localTool(tool, withSurface);
  }

  S.rpc.unshift({ id, tool, args: withSurface, result, mode, ms: performance.now() - t0 });
  if (S.rpc.length > 40) S.rpc.pop();
  renderRpc();
  return result;
}

function localTool(tool, a) {
  const surface = surfaceById(a.surface) ?? sf();
  switch (tool) {
    case 'experiment_run':
      return E.runMonteCarlo({ surface, levers: a.levers, n: a.n ?? 120, seed: a.seed ?? 5 });
    case 'session_status':
      return S.ses ? { surface: a.surface, stage: S.ses.stageId, done: S.ses.done, ...E.metricsOf(S.ses) } : { idle: true };
    case 'dataset_export':
      return { surface: a.surface, rows: S.ses ? S.ses.dataset.length : 0, format: a.format ?? 'jsonl' };
    case 'skill_list':
      return { skills: S.skills.filter(k => k.surface === a.surface).map(({ id, name, armed }) => ({ id, name, armed })) };
    case 'skill_transfer':
      return transferLocally(a);
    default:
      return { ok: true, tool, args: a };
  }
}

/** Same logic the server runs, so the transfer demo works offline too. */
function transferLocally(a) {
  const sk = S.skills.find(k => k.id === a.skill_id);
  const target = surfaceById(a.to);
  const src = surfaceById(sk.surface);
  const srcLever = src.levers.find(l => l.id === sk.action[0]);
  if (!srcLever?.transfers?.includes(target.id)) {
    return { transferable: false, reason: `${sk.action[0]} declares no transfer to ${target.id}`, declared: srcLever?.transfers ?? [] };
  }
  const match = target.levers.find(l => (l.transfers ?? []).includes(src.id)) ?? target.levers[0];
  const x = E.runMonteCarlo({ surface: target, levers: [match.id], n: a.n ?? 100, seed: 5 });
  return {
    transferable: true, from: src.id, to: target.id, source_skill: sk.name,
    target_lever: match.id, target_label: match.label,
    source_lift_pct: sk.evidence.roi_lift_pct, target_lift_pct: x.metrics.roi.lift_pct,
    ci90: x.metrics.roi.ci90, verdict: x.verdict,
  };
}

function renderRpc() {
  const box = $('rpcLog');
  if (!S.rpc.length) { box.innerHTML = '<div class="empty">No calls yet.</div>'; return; }
  box.innerHTML = S.rpc.map(r => {
    const a = JSON.stringify(r.args);
    const out = JSON.stringify(r.result);
    return `<div class="rpcrow">
      <div><span class="o">#${r.id}</span> <span class="m">tools/call</span> ${esc(r.tool)}
        <span class="o">[${r.mode} · ${r.ms.toFixed(0)}ms]</span></div>
      <div class="o">→ ${esc(a.length > 120 ? a.slice(0, 120) + '…' : a)}</div>
      <div class="r">← ${esc(out.length > 200 ? out.slice(0, 200) + '…' : out)}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════ live loop ════════════════════════════════ */

function newSession() {
  stop();
  S.ses = E.createSession({ surface: sf(), seed: Math.floor(Math.random() * 9e6), levers: armedLevers(), live: true });
  S.focusHist = []; S.ticker = [];
  S.cues = M.cuesFor(S.surfaceId, sf().horizon, sf().stages);
  S.fired = new Set();
  applySurfaceChrome();
  renderBrief();
  if (sf().view === 'tiles') renderTiles(true);
  renderAll();
}

function start() {
  if (S.timer) return;
  S.timer = setInterval(step, { 1: 1000, 4: 250, 16: 62 }[S.speed]);
  $('recPill').classList.remove('off');
  $('recPill').innerHTML = '<span class="rec-dot"></span>OBSERVING';
}

function stop() { clearInterval(S.timer); S.timer = null; }

function step() {
  const s = S.ses;
  if (!s || s.done) {
    stop();
    $('recPill').classList.add('off');
    $('recPill').textContent = 'RUN COMPLETE';
    if (!s._remembered) {
      s._remembered = true;                 // step() can re-enter before the interval clears
      M.remember(s, E.metricsOf);
      renderBrief();
      renderMemory();
    }
    renderDataset();
    return;
  }
  for (const ev of E.tick(s)) {
    if (ev.type === sf().events.capture) { flashScan(); companion.flash(); }
    pushTicker(ev);
  }
  fireDueCues(s);
  S.focusHist.push(E.focusOf(s));
  if (S.focusHist.length > 120) S.focusHist.shift();
  renderAll();
}

/* ═══════════════════════════ surface chrome ═══════════════════════════ */

/** Re-label everything surface-specific. One console, six vocabularies. */
function applySurfaceChrome() {
  const s = sf();
  $('surfSel').value = s.id;
  $('actorWord').textContent = s.actorPlural;
  $('surfWord').textContent = s.title;
  $('theirView').textContent = s.actorNoun + ' view — no companion UI visible here';
  $('chatHead').textContent = s.signalNoun;
  $('focusLabel').textContent = s.focusNoun;
  $('vMqlL').textContent = 'Exp. ' + s.economics.outcomeNoun + 's';
  $('presenter').classList.toggle('hidden', s.view !== 'tiles');
  $('tiles').classList.toggle('hidden', s.view !== 'tiles');
  $('flow').classList.toggle('hidden', s.view === 'tiles');
}

/* ════════════════════════════════ rendering ═══════════════════════════════ */

function renderAll() {
  const s = S.ses; if (!s) return;
  const surface = sf();
  const act = s.roster.filter(a => a.joinedAt <= s.t && a.leftAt === null);
  const st = E.stageAt(s.t / surface.stageUnit, s.stages);
  const m = E.metricsOf(s);

  $('sClock').textContent = E.fmtClock(surface, s.t);
  $('sPhase').textContent = st.label;
  $('roomCount').textContent = act.length;
  $('slideKicker').textContent = st.label;
  $('slideTitle').textContent = st.headline;

  const focus = E.focusOf(s);
  $('vRoom').textContent = act.length;
  $('vRoomD').textContent = 'peak ' + s.peak;
  $('vRet').textContent = s.peak ? Math.round((act.length / s.peak) * 100) + '%' : '—';
  $('vAttn').textContent = focus ? Math.round(focus * 100) : '—';
  const prev = S.focusHist[S.focusHist.length - 6];
  const d = prev ? focus - prev : 0;
  const ad = $('vAttnD');
  ad.textContent = prev ? (d >= 0 ? '▲' : '▼') + ' ' + Math.abs(d * 100).toFixed(1) : ' ';
  ad.className = d >= 0 ? 'up' : 'down';
  $('vMql').textContent = m.outcomes;
  $('sparkNow').textContent = Math.round(focus * 100) + '/100';

  renderSpark();
  if (surface.view === 'tiles') renderTiles(false); else renderFlow();
  renderRisk(act);
  renderNudges();
  renderCaps();
  renderSignals();
  $('ticker').innerHTML = S.ticker.slice(0, 24).join('');
}

function renderSpark() {
  const h = S.focusHist; if (h.length < 2) return;
  const w = 300, ht = 60, n = h.length;
  const pts = h.map((v, i) => [(i / (n - 1)) * w, ht - Math.max(0.02, Math.min(1, v)) * ht]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  $('sparkLine').setAttribute('d', d);
  $('sparkArea').setAttribute('d', d + ' L' + w + ' ' + ht + ' L0 ' + ht + ' Z');
}

const displayName = a => (S.anon && sf().actorNames !== 'item' ? a.id.replace('a_', 'actor-') : a.name);
const initials = a => (sf().actorNames === 'item'
  ? a.name.split('-')[1]
  : a.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase());

const MAXTILE = 49;

function renderTiles(rebuild) {
  const s = S.ses, box = $('tiles');
  const shown = s.roster.slice(0, MAXTILE);
  if (rebuild || box.children.length !== shown.length) {
    box.innerHTML = '';
    for (const a of shown) {
      const t = document.createElement('div');
      t.className = 'tile';
      t.dataset.id = a.id;
      t.innerHTML = '<i class="rk"></i>' + initials(a) + '<span class="nm">' + esc(displayName(a)) + '</span>';
      t.querySelector('.rk').style.background = sf().segments[a.segment].color;
      box.appendChild(t);
    }
  }
  for (const t of box.children) {
    const a = s.roster.find(x => x.id === t.dataset.id);
    const here = a.joinedAt <= s.t && a.leftAt === null;
    t.classList.toggle('gone', !here);
    t.classList.toggle('risk', here && a.focus < 0.3);
  }
}

/**
 * Stage flow. In this model the stage is a function of the clock, so the board
 * fills in left to right as the run advances - which is exactly the survivor
 * funnel you want to read, and it works for every non-meeting surface.
 */
function stageStats(s) {
  const u = sf().stageUnit;
  let remaining = s.roster.filter(a => a.joinedAt <= s.t).length;
  return s.stages.map(st => {
    const lost = s.roster.filter(a => a.leftAt !== null && a.leftAt / u >= st.from && a.leftAt / u < st.to);
    remaining -= lost.length;
    const reasons = {};
    for (const a of lost) reasons[a.leaveReason] = (reasons[a.leaveReason] ?? 0) + 1;
    const top = Object.entries(reasons).sort((x, y) => y[1] - x[1])[0];
    return { st, lost: lost.length, left: remaining, topReason: top, reached: s.t / u >= st.from };
  });
}

function renderFlow() {
  const s = S.ses;
  const peak = Math.max(1, s.peak);
  const now = s.stageId;
  $('flow').innerHTML = stageStats(s).map(r => {
    // A stage the run has not reached yet must read as empty. r.left carries the
    // current remaining count, so drawing it for every row made unreached stages
    // look like everyone had already passed through them.
    const w = r.reached ? Math.max(1.5, (r.left / peak) * 100) : 0;
    const lostW = Math.max(0, (r.lost / peak) * 100);
    return '<div class="frow ' + (r.st.id === now ? 'now' : '') + ' ' + (r.reached ? '' : 'pending') + '">'
      + '<div class="fmeta"><b>' + esc(r.st.label) + '</b><span>' + esc(r.st.headline) + '</span></div>'
      + '<div class="fbar"><i class="keep" style="width:' + w + '%"></i>'
      + '<i class="lost" style="left:' + w + '%;width:' + lostW + '%"></i></div>'
      + '<div class="fnum"><b>' + (r.reached ? r.left : '—') + '</b><span>'
      + (r.lost ? '−' + r.lost + (r.topReason ? ' · ' + r.topReason[0] : '') : (r.reached ? 'held' : 'ahead'))
      + '</span></div></div>';
  }).join('');
}

function renderRisk(act) {
  const box = $('riskList');
  const surface = sf();
  const st = E.stageAt(S.ses.t / surface.stageUnit, S.ses.stages);
  const risky = act
    .map(a => ({ a, hz: st.drop * surface.segments[a.segment].dropMult * (1.38 - a.focus) * 100 }))
    .filter(x => x.a.focus < 0.42)
    .sort((x, y) => y.hz - x.hz)
    .slice(0, 5);
  $('riskCnt').textContent = act.filter(a => a.focus < 0.42).length;
  if (!risky.length) { box.innerHTML = '<div class="empty">Nobody flagged.</div>'; return; }
  box.innerHTML = risky.map(({ a, hz }) => '<div class="riskrow">'
    + '<span class="p" style="background:' + surface.segments[a.segment].color + '"></span>'
    + '<span class="who">' + esc(displayName(a)) + ' · ' + surface.segments[a.segment].label.toLowerCase() + '</span>'
    + '<span class="haz">' + hz.toFixed(2) + '%/t</span></div>').join('');
}

function renderNudges() {
  const box = $('nudgeList');
  // Memory cues are the whole point of the companion, and they fire early - so
  // a tail-of-the-list view buries them under routine live nudges every time.
  // Keep the two most recent of each, memory first.
  const all = S.ses.nudges;
  const mem = all.filter(n => n.memory).slice(-2).reverse();
  const live = all.filter(n => !n.memory).slice(-2).reverse();
  const list = [...mem, ...live];
  $('nudgeCnt').textContent = all.length;
  if (!list.length) { box.innerHTML = '<div class="empty">Watching…</div>'; return; }
  box.innerHTML = list.map(n => '<div class="nudge ' + (n.memory ? 'memory' : n.urgency) + '">'
    + '<div class="nt"><span>' + n.ts + '</span><span>' + (n.memory ? 'FROM MEMORY' : n.urgency.toUpperCase()) + '</span><span>' + n.stage + '</span></div>'
    + esc(n.text) + '</div>').join('');
}

function renderCaps() {
  const box = $('capList');
  const list = S.ses.moments.slice(-6).reverse();
  $('capCnt').textContent = S.ses.moments.length;
  box.innerHTML = list.map(c => {
    const h = hue(c.caption);
    return '<div class="cap"><div class="thumb" style="background:linear-gradient(140deg,hsl(' + h
      + ' 55% 26%),hsl(' + ((h + 48) % 360) + ' 45% 13%))">' + c.ts + '</div>'
      + '<div class="meta"><b>' + c.kind.replace(/_/g, ' ') + '</b>' + esc(c.caption) + '</div></div>';
  }).join('');
}

function renderSignals() {
  const box = $('chatList');
  // Collapse consecutive repeats - a 400-actor cohort hits the same friction at
  // the same moment, and a wall of identical lines reads as a bug.
  const list = [];
  for (const c of S.ses.signals.slice(-26)) {
    const last = list[list.length - 1];
    if (last && last.text === c.text) { last.n++; continue; }
    list.push({ ...c, n: 1 });
  }
  const view = list.slice(-13);
  if (!view.length) {
    if (box.dataset.key !== 'empty') {
      box.dataset.key = 'empty';
      box.innerHTML = '<div class="empty">No signals yet — this stage is not interactive.</div>';
    }
    return;
  }
  const key = view.length + '|' + view[view.length - 1].text;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = view.map(c => '<div class="cmsg"><b>'
    + esc(S.anon ? 'actor-' + (hue(c.name) % 900 + 100) : c.name)
    + (c.n > 1 ? ' +' + (c.n - 1) + ' more' : '') + '</b><span>' + esc(c.text) + '</span></div>').join('');
  box.scrollTop = box.scrollHeight;
}

function pushTicker(ev) {
  const e = sf().events;
  const cls = ev.type === e.leave ? 'r' : ev.type === e.join || ev.type === e.save ? 'g'
    : ev.type === e.capture || ev.type === e.nudge ? 'k' : '';
  const who = ev.actor.startsWith('a_') && S.anon ? ev.actor.replace('a_', 'actor-') : ev.actor;
  let detail = '';
  if (ev.type === e.leave) detail = ev.payload.reason;
  else if (ev.type === e.signal) detail = ev.payload.text.slice(0, 32);
  else if (ev.type === e.capture) detail = ev.payload.kind;
  else if (ev.type === e.stage) detail = ev.payload.stage;
  S.ticker.unshift('<div><span class="' + cls + '">' + ev.ts + '</span> ' + ev.type
    + ' <span class="o">' + who + '</span> ' + esc(detail) + '</div>');
  if (S.ticker.length > 40) S.ticker.pop();
}

function flashScan() {
  const n = $('hudScan');
  n.classList.remove('go'); void n.offsetWidth; n.classList.add('go');
}

/* ════════════════════════════════ memory ═════════════════════════════════
 * Cues come from previous runs, so they can fire BEFORE the thing they warn
 * about. That head start is the entire point - a warning that arrives together
 * with the drop-off is just a slower dashboard.
 * ═══════════════════════════════════════════════════════════════════════════ */

function fireDueCues(s) {
  const pos = s.t / sf().stageUnit;
  for (const c of S.cues) {
    if (S.fired.has(c.id) || pos < c.at) continue;
    S.fired.add(c.id);
    s.nudges.push({
      id: 'mem_' + c.id, t: s.t, ts: E.fmtClock(sf(), s.t),
      urgency: 'medium', memory: true, stage: s.stageId,
      text: c.say + '  (' + c.why + ')',
    });
  }
}

const fmtPos = p => {
  const u = sf().clock;
  if (u === 'days') return 'day ' + (1 + Math.floor(p));
  if (u === 'hours') return 'h+' + p.toFixed(1);
  return String(Math.floor(p)).padStart(2, '0') + ':' + String(Math.round((p % 1) * 60)).padStart(2, '0');
};

function renderBrief() {
  const b = M.brief(S.surfaceId, sf().horizon, sf().stages);
  const box = $('brief');
  if (!box) return;
  if (!b.ready) {
    box.className = 'brief waiting';
    box.innerHTML = '<b>Memory</b>' + esc(b.message);
    return;
  }
  box.className = 'brief';
  const trend = b.trend
    ? ' Retention across your last ' + b.trend.recent + ' runs is ' + pct(b.trend.retention_delta * 100)
      + ' against the ones before.'
    : '';
  box.innerHTML = '<b>Before this run</b>' + esc(b.message + trend)
    + b.cues.slice(0, 3).map(c => '<div class="bcue"><span>' + fmtPos(c.at) + '</span><span>'
      + esc(c.say.slice(0, 82)) + '…</span></div>').join('');
}

function renderMemory() {
  const box = $('memBody');
  if (!box) return;
  const b = M.brief(S.surfaceId, sf().horizon, sf().stages);
  const eps = M.episodesFor(M.load(), S.surfaceId).slice().reverse();

  const head = '<div class="honest">' + esc(b.message)
    + (b.ready ? '' : ' A pattern has to reproduce before the companion will say it out loud.') + '</div>';

  const cues = b.cues.length
    ? '<h4>Cues armed for the next run</h4><div class="cuelist">'
      + b.cues.map(c => '<div class="cuerow"><span class="at">' + fmtPos(c.at) + '</span><span>'
        + esc(c.say) + '</span><span class="why">' + esc(c.why) + '</span></div>').join('') + '</div>'
    : '';

  const pats = b.patterns.length
    ? '<h4>Patterns</h4><div class="memgrid">' + b.patterns.map(p =>
      '<div class="pat' + (p.stale ? ' stale' : '') + '">'
      + '<div class="conf"><div class="confbar"><i style="width:' + Math.round(p.confidence * 100)
      + '%"></i></div><b>' + p.confidence.toFixed(2) + '</b></div>'
      + '<h3>' + esc(p.statement) + '</h3>'
      + '<div class="det">' + esc(p.detail) + '</div>'
      + '<div class="ev"><span class="kindtag' + (p.observational ? ' obs' : '') + '">'
      + p.kind.replace(/_/g, ' ') + '</span><span>' + p.evidence.n + '/' + p.evidence.of + ' runs</span>'
      + '<span>confirmed ' + p.confirmed + (p.contradicted ? ' · missed ' + p.contradicted : '') + '</span>'
      + '<button class="fbtn" data-forget="' + p.id + '">forget</button></div></div>').join('') + '</div>'
    : '';

  const episodes = eps.length
    ? '<h4>Episodes</h4><div class="eplist">' + eps.map(e =>
      '<div class="eprow"><span class="epid">' + e.id.slice(0, 18) + '</span><span>'
      + esc(e.losses[0] ? 'worst: ' + e.losses[0].label + ' (−' + e.losses[0].count + ')' : 'no departures')
      + '</span><span>ret <b>' + (e.metrics.retention * 100).toFixed(0) + '%</b></span>'
      + '<span>' + e.metrics.outcomes + ' out</span></div>').join('') + '</div>'
    : '<div class="empty big">No runs recorded on this surface yet.</div>';

  box.innerHTML = head + cues + pats + episodes;
  for (const btn of box.querySelectorAll('[data-forget]')) {
    btn.onclick = () => { M.forget(btn.dataset.forget); renderMemory(); renderBrief(); };
  }
}

/** Record real runs headlessly, so memory has something to reason over. */
async function seedMemory(n) {
  const btn = $('btnSeedMem');
  btn.disabled = true;
  for (let i = 0; i < n; i++) {
    btn.textContent = 'Recording ' + (i + 1) + '/' + n + '…';
    await new Promise(r => setTimeout(r, 20));
    const r = E.runSession({ surface: sf(), seed: Math.floor(Math.random() * 9e6), levers: armedLevers() });
    M.remember(r.session, E.metricsOf);
  }
  btn.disabled = false; btn.textContent = 'Record 3 runs';
  renderMemory(); renderBrief();
}

/* ════════════════════════════════ dataset ═════════════════════════════════ */

function renderDataset() {
  const s = S.ses; if (!s) return;
  const rows = s.dataset;
  const types = [...new Set(rows.map(r => r.type))].sort();
  const sel = $('dsFilter');
  if (sel.dataset.surface !== S.surfaceId || sel.options.length !== types.length + 1) {
    sel.dataset.surface = S.surfaceId;
    sel.innerHTML = '<option value="">all types</option>' + types.map(t => '<option>' + t + '</option>').join('');
  }
  const f = sel.value;
  const view = (f ? rows.filter(r => r.type === f) : rows).slice(-260).reverse();

  const labelled = rows.filter(r => r.label.churn_next !== null).length;
  const pos = rows.filter(r => r.label.churn_next === 1).length;
  $('dsStats').innerHTML = [
    ['rows', rows.length], ['event types', types.length],
    ['labelled', labelled], ['churn positives', pos],
    ['captured moments', s.moments.length], ['run', s.done ? 'closed' : 'open'],
  ].map(([k, v]) => '<div class="dsstat"><b>' + v + '</b><span>' + k + '</span></div>').join('');

  $('dsBody').innerHTML = view.map(r => '<tr>'
    + '<td>' + r.ts + '</td>'
    + '<td><span class="ty" style="border-color:' + tyc(r) + '44;color:' + tyc(r) + '">' + r.type + '</span></td>'
    + '<td>' + esc(S.anon && r.actor.startsWith('a_') ? r.actor.replace('a_', 'actor-') : r.actor) + '</td>'
    + '<td>' + r.stage + '</td>'
    + '<td class="j">' + esc(JSON.stringify(r.payload)) + '</td>'
    + '<td class="j">' + esc(JSON.stringify(r.features)) + '</td>'
    + '<td class="j">' + esc(JSON.stringify(r.label)) + '</td></tr>').join('');

  // Lead the schema with a row that carries labels - a companion-emitted row has
  // none, and an all-null label block explains nothing about the schema.
  const sample = [...rows].reverse().find(r => r.label.churn_next !== null) || rows[rows.length - 1];
  $('schemaBox').textContent = JSON.stringify(sample || { note: 'run a session' }, null, 2);
}

function tyc(r) {
  const e = sf().events;
  if (r.type === e.leave) return '#b8203f';
  if (r.type === e.join || r.type === e.save) return '#0d7a4f';
  if (r.type === e.capture || r.type === e.nudge) return '#2563a8';
  if (r.type === e.deep) return '#5b4bb8';
  return '#5a6b76';
}

function download(name, text, mime) {
  const b = new Blob([text], { type: mime });
  const u = URL.createObjectURL(b);
  const a = Object.assign(document.createElement('a'), { href: u, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1500);
}

/* ═════════════════════════════ experiment lab ═════════════════════════════ */

const selected = new Set();

function renderLevers() {
  const armed = armedLevers();
  $('levers').innerHTML = sf().levers.map(l => '<div class="lever ' + (selected.has(l.id) ? 'on' : '') + '" data-id="' + l.id + '">'
    + '<div class="lh"><span class="bx"></span>' + esc(l.label)
    + (armed.includes(l.id) ? '<span class="armed">ARMED</span>' : '') + '</div>'
    + '<p>' + esc(l.hypo) + '</p>'
    + (l.transfers && l.transfers.length ? '<div class="xfer">transfers to ' + l.transfers.join(', ') + '</div>' : '')
    + '</div>').join('');
  for (const n of $('levers').children) {
    n.onclick = () => {
      const id = n.dataset.id;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      renderLevers();
    };
  }
}

async function runExperiment() {
  if (!selected.size) return;
  const btn = $('btnRun');
  btn.disabled = true; btn.textContent = 'Running…';
  await new Promise(r => setTimeout(r, 30));

  const n = Math.max(20, Math.min(600, +$('expN').value || 120));
  const exp = await mcp('experiment_run', { levers: [...selected], n, seed: 5 });

  S.experiments.unshift(exp);
  renderExpResult(exp);
  renderExpLog();
  btn.disabled = false; btn.textContent = 'Run experiment';
}

function ciBar(ci) {
  const lo = ci[0], hi = ci[1];
  const min = Math.min(-15, lo), max = Math.max(15, hi), span = max - min;
  const l = ((lo - min) / span) * 100, w = ((hi - lo) / span) * 100, z = ((0 - min) / span) * 100;
  // Colour the interval by where it sits: clear win, clear loss, or straddling
  // zero. A green bar under a negative number reads as a bug.
  const fill = lo > 0 ? 'linear-gradient(90deg,var(--cy),var(--li))'
    : hi < 0 ? 'linear-gradient(90deg,var(--rd),#ff8494)'
      : 'linear-gradient(90deg,var(--rd),var(--am),var(--li))';
  return '<div class="ci"><i style="left:' + l + '%;width:' + Math.max(w, 1.5) + '%;background:' + fill
    + '"></i><u style="left:' + z + '%"></u></div>';
}

function mcard(name, m) {
  return '<div class="mcard"><div class="mn">' + name + '</div>'
    + '<div class="mv ' + (m.lift_pct >= 0 ? 'pos' : 'neg') + '">' + pct(m.lift_pct) + '</div>'
    + '<div class="mb">' + m.baseline + ' → ' + m.variant + '</div>'
    + ciBar(m.ci90)
    + '<div class="mb" style="margin-top:5px">90% CI ' + m.ci90[0] + '% … ' + m.ci90[1] + '%</div>'
    + (m.spread90 ? '<div class="mb dim">run spread ' + m.spread90[0] + '% … ' + m.spread90[1] + '%</div>' : '')
    + '</div>';
}

function renderExpResult(x) {
  $('expEmpty').classList.add('hidden');
  const box = $('expResult'); box.classList.remove('hidden');
  const r = x.metrics.roi;
  const surface = surfaceById(x.surface) || sf();
  const names = x.levers.map(id => E.leverById(surface, id).label).join(' + ');
  const already = S.skills.some(k => k.surface === x.surface && k.action.join('+') === x.levers.join('+'));

  box.innerHTML = '<div class="verdict">'
    + '<div><div class="big ' + (r.lift_pct >= 0 ? 'pos' : 'neg') + '">' + pct(r.lift_pct) + '</div></div>'
    + '<div class="lbl"><b>' + esc(names) + '</b><br>ROI lift on ' + esc(surface.label)
    + ' · ' + x.n + ' paired runs per arm<br>90% interval on the mean ' + r.ci90[0] + '% … ' + r.ci90[1] + '%</div>'
    + '<span class="vtag ' + x.verdict + '">' + x.verdict + '</span></div>'
    + '<div class="mgrid">'
    + mcard('Retention', x.metrics.retention)
    + mcard('Avg dwell', x.metrics.avg_dwell)
    + mcard('Expected ' + surface.economics.outcomeNoun + 's', x.metrics.outcomes)
    + mcard('Pipeline', x.metrics.pipeline)
    + '</div>'
    + '<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">'
    + '<button class="btn primary" id="btnPromote"' + (x.verdict === 'reject' || already ? ' disabled' : '') + '>'
    + (already ? 'Already in library' : 'Promote to skill') + '</button>'
    + '<span class="honest">' + (x.significant
      ? 'The interval on the mean clears zero — this may become a skill.'
      : 'The interval on the mean spans zero. Not separable from noise at this sample size; raise runs or drop it.')
    + '</span></div>';

  const b = $('btnPromote');
  if (b) b.onclick = () => promote(x);
}

function promote(x) {
  const surface = surfaceById(x.surface) || sf();
  S.skills.unshift(E.skillFromExperiment(surface, x));
  mcp('skill_promote', { levers: x.levers, n: x.n });
  renderSkills(); renderLevers(); renderExpResult(x);
  switchTab('skills');
}

function renderExpLog() {
  const box = $('expLog');
  if (!S.experiments.length) { box.innerHTML = '<div class="empty">No experiments yet.</div>'; return; }
  box.innerHTML = S.experiments.slice(0, 12).map(x => {
    const surface = surfaceById(x.surface) || sf();
    const r = x.metrics.roi;
    return '<div class="elog"><span class="en">' + x.surface + ' · n=' + x.n + '</span>'
      + '<span class="es">' + esc(x.levers.map(i => E.leverById(surface, i).label).join(' + ')) + '</span>'
      + '<span class="vtag ' + x.verdict + '" style="padding:2px 8px;font-size:9px">' + x.verdict + '</span>'
      + '<span class="ev ' + (r.lift_pct >= 0 ? 'pos' : 'neg') + '">' + pct(r.lift_pct) + '</span></div>';
  }).join('');
}

/* ═══════════════════════════════ skill library ═══════════════════════════ */

function renderSkills() {
  $('skillGrid').innerHTML = skillsHere().map(k => '<div class="skill ' + (k.armed ? 'armed' : '') + '">'
    + '<label class="sw"><input type="checkbox" data-sk="' + k.id + '"' + (k.armed ? ' checked' : '') + '><span></span></label>'
    + '<h3>' + esc(k.name) + '</h3>'
    + '<div class="hyp">' + esc(k.hypothesis) + '</div>'
    + '<div class="trg">when ' + esc(k.trigger) + ' → apply ' + esc(k.action.join(', ')) + '</div>'
    + '<div class="evid">'
    + '<div><b style="color:var(--li)">' + pct(k.evidence.roi_lift_pct) + '</b><span>roi lift</span></div>'
    + '<div><b>' + k.evidence.simulations + '</b><span>sims</span></div>'
    + '<div><b>' + (k.evidence.retention_lift_pct >= 0 ? '+' : '') + k.evidence.retention_lift_pct + '%</b><span>retention</span></div>'
    + '</div>'
    + '<div class="prov">90% CI ' + k.evidence.ci90[0] + '% … ' + k.evidence.ci90[1] + '% · promoted ' + k.promoted_at.slice(0, 10) + '</div>'
    + (k.transfers && k.transfers.length
      ? '<div class="xrow"><span>try on</span>' + k.transfers.map(t =>
        '<button class="xbtn" data-from="' + k.id + '" data-to="' + t + '">' + t + '</button>').join('') + '</div>'
      : '')
    + '</div>').join('');

  for (const cb of $('skillGrid').querySelectorAll('input[data-sk]')) {
    cb.onchange = () => {
      S.skills.find(k => k.id === cb.dataset.sk).armed = cb.checked;
      mcp('skill_arm', { skill_id: cb.dataset.sk, armed: cb.checked });
      renderSkills(); renderLevers();
    };
  }
  for (const b of $('skillGrid').querySelectorAll('.xbtn')) {
    b.onclick = () => transfer(b.dataset.from, b.dataset.to, b);
  }
}

async function transfer(skillId, to, btn) {
  btn.disabled = true; btn.textContent = 'testing…';
  const r = await mcp('skill_transfer', { skill_id: skillId, to, n: 100 });
  btn.disabled = false; btn.textContent = to;
  const box = $('transferOut');
  if (!r.transferable) { box.innerHTML = '<div class="xfout bad">' + esc(r.reason) + '</div>'; return; }
  const keeps = r.target_lift_pct > 0;
  box.innerHTML = '<div class="xfout ' + (keeps ? '' : 'bad') + '">'
    + '<div class="xfhead">' + esc(r.source_skill) + ' · ' + r.from + ' → ' + r.to + '</div>'
    + '<div class="xfbody">'
    + '<div><b>' + pct(r.source_lift_pct) + '</b><span>on ' + r.from + '</span></div>'
    + '<div class="arrow">→</div>'
    + '<div><b class="' + (keeps ? 'pos' : 'neg') + '">' + pct(r.target_lift_pct) + '</b>'
    + '<span>as “' + esc(r.target_label) + '” on ' + r.to + '</span></div>'
    + '<span class="vtag ' + r.verdict + '">' + r.verdict + '</span></div>'
    + '<div class="prov">90% CI ' + r.ci90[0] + '% … ' + r.ci90[1] + '% · 100 paired runs on ' + r.to + '</div></div>';
}

async function retestLibrary() {
  const btn = $('btnRetest');
  btn.disabled = true; btn.textContent = 'Re-testing…';
  for (const k of skillsHere()) {
    await new Promise(r => setTimeout(r, 20));
    const x = await mcp('experiment_run', { levers: k.action, n: 120, seed: 9 });
    k.evidence = {
      simulations: x.n, roi_lift_pct: x.metrics.roi.lift_pct, ci90: x.metrics.roi.ci90,
      retention_lift_pct: x.metrics.retention.lift_pct, outcome_lift_pct: x.metrics.outcomes.lift_pct,
    };
    if (x.verdict === 'reject') k.armed = false;
    renderSkills();
  }
  btn.disabled = false; btn.textContent = 'Re-test this surface';
}

/* ═════════════════════════════════ ROI ═══════════════════════════════════ */

const honest = () => '<div class="honest">These are <b>simulated</b> outcomes from the calibrated model in '
  + '<code>engine/</code>, not measured results from live deployments. The pipeline is what ships; the '
  + 'constants are what a real deployment would refit on its own observation dataset after a handful of '
  + 'runs. Skills stack with diminishing returns (each added skill damped 0.86×), so a library total is '
  + 'deliberately smaller than the sum of its parts.</div>';

async function computeRoi() {
  const btn = $('btnRoi');
  btn.disabled = true; btn.textContent = 'Simulating…';
  $('roiBody').innerHTML = '<div class="empty big">Running paired simulations…</div>';
  await new Promise(r => setTimeout(r, 30));

  const surface = sf();
  const levers = armedLevers();
  const n = 120;
  $('roiN').textContent = n;

  if (!levers.length) {
    $('roiBody').innerHTML = '<div class="empty big">No skills armed on this surface. Arm one in the Skills tab.</div>';
    btn.disabled = false; btn.textContent = 'This surface'; return;
  }

  // The last step is the whole library, so it doubles as the headline - running
  // it at a different sample size would make the waterfall disagree with itself.
  const steps = [];
  let full = null;
  for (let k = 1; k <= levers.length; k++) {
    const r = await mcp('experiment_run', { levers: levers.slice(0, k), n, seed: 5 });
    steps.push({ label: E.leverById(surface, levers[k - 1]).label, cum: r.metrics.roi.lift_pct });
    if (k === levers.length) full = r;
  }

  const m = full.metrics;
  const ec = surface.economics;
  const gain = (m.pipeline.variant - m.pipeline.baseline) * ec.winRate;

  $('roiBody').innerHTML = '<div class="roitop">'
    + '<div class="roibig hero"><div class="rl">ROI lift · ' + esc(surface.label) + '</div>'
    + '<div class="rv">' + pct(m.roi.lift_pct) + '</div>'
    + '<div class="rd">90% interval ' + m.roi.ci90[0] + '% … ' + m.roi.ci90[1] + '% over ' + n + ' paired runs</div></div>'
    + '<div class="roibig"><div class="rl">Retention</div><div class="rv">' + pct(m.retention.lift_pct) + '</div>'
    + '<div class="rd">' + (m.retention.baseline * 100).toFixed(1) + '% → ' + (m.retention.variant * 100).toFixed(1) + '% of peak</div></div>'
    + '<div class="roibig"><div class="rl">Expected ' + esc(ec.outcomeNoun) + 's</div><div class="rv">' + pct(m.outcomes.lift_pct) + '</div>'
    + '<div class="rd">' + m.outcomes.baseline + ' → ' + m.outcomes.variant + ' per run</div></div>'
    + '<div class="roibig"><div class="rl">Attributable value</div><div class="rv">' + money(gain) + '</div>'
    + '<div class="rd">per run, at ' + (ec.winRate * 100).toFixed(0) + '% conversion on ' + money(ec.unitValue) + '</div></div>'
    + '</div>'
    + '<div class="waterfall"><h4>Where the lift comes from</h4>'
    + '<div class="wrow base"><span class="wn">Baseline</span><span class="wb"><i style="width:6%"></i></span><span class="wv">0.0%</span></div>'
    + steps.map(s => '<div class="wrow"><span class="wn">+ ' + esc(s.label) + '</span>'
      + '<span class="wb"><i style="width:' + Math.max(3, Math.min(100, (s.cum / Math.max(1, m.roi.lift_pct)) * 100)) + '%"></i></span>'
      + '<span class="wv">' + pct(s.cum) + '</span></div>').join('')
    + '<div class="wrow"><span class="wn"><b>Armed library</b></span><span class="wb"><i style="width:100%"></i></span>'
    + '<span class="wv" style="color:var(--li)">' + pct(m.roi.lift_pct) + '</span></div></div>'
    + honest();

  btn.disabled = false; btn.textContent = 'This surface';
}

async function computePortfolio() {
  const btn = $('btnPortfolio');
  btn.disabled = true; btn.textContent = 'Simulating…';
  $('roiBody').innerHTML = '<div class="empty big">Running every surface…</div>';
  await new Promise(r => setTimeout(r, 30));

  const rows = [];
  for (const surface of SURFACE_LIST) {
    const levers = S.skills.filter(k => k.surface === surface.id && k.armed).flatMap(k => k.action);
    if (!levers.length) { rows.push({ surface, none: true }); continue; }
    const r = E.runMonteCarlo({ surface, levers, n: 60, seed: 5 });
    rows.push({ surface, m: r.metrics, armed: levers.length });
  }
  const best = Math.max.apply(null, rows.filter(r => r.m).map(r => r.m.roi.lift_pct).concat([1]));

  $('roiBody').innerHTML = '<div class="waterfall">'
    + '<h4>Every surface · armed library vs baseline · 60 paired runs each</h4>'
    + rows.map(r => r.none
      ? '<div class="wrow base"><span class="wn">' + esc(r.surface.label) + '</span><span class="wb"></span><span class="wv">no skills</span></div>'
      : '<div class="wrow"><span class="wn">' + esc(r.surface.label) + '</span>'
        + '<span class="wb"><i style="width:' + (r.m.roi.lift_pct / best) * 100 + '%"></i></span>'
        + '<span class="wv" style="color:var(--li)">' + pct(r.m.roi.lift_pct) + '</span></div>'
        + '<div class="wsub">' + r.armed + ' skills · retention ' + pct(r.m.retention.lift_pct)
        + ' · ' + esc(r.surface.economics.outcomeNoun) + 's ' + pct(r.m.outcomes.lift_pct)
        + ' · CI ' + r.m.roi.ci90[0] + '% … ' + r.m.roi.ci90[1] + '%</div>').join('')
    + '</div>'
    + '<div class="honest">The spread is the finding. Surfaces already running well — a queue resolving 77% '
    + 'of tickets cleanly, a review pipeline merging 79% of PRs — have little headroom, and the library is '
    + 'worth low double digits there. Leaky surfaces have far more. A companion that only ever watched '
    + 'webinars could not have told you that.</div>'
    + honest();

  btn.disabled = false; btn.textContent = 'All surfaces';
}

/* ════════════════════════════════ MCP tab ════════════════════════════════ */

const FALLBACK_TOOLS = [
  ['surfaces_list', 'Every surface Backstage can observe, with actors, stages, clock and economics.', '—'],
  ['session_start', 'Open an observation session on a surface and advance it.', 'surface, cohort, advance, skills'],
  ['session_advance', 'Advance the open session and return the events emitted.', 'surface, units'],
  ['session_status', 'Live vitals: concurrency, retention, focus, expected outcomes, ROI.', 'surface'],
  ['observe_stream', 'Observation events since a cursor.', 'surface, since_seq, types'],
  ['capture_moment', 'Register a keyframe capture with a caption.', 'surface, caption, kind'],
  ['dataset_query', 'Filter the labelled dataset by type / stage / actor.', 'surface, type, stage, limit'],
  ['dataset_export', 'Export a surface dataset as JSONL or CSV.', 'surface, format'],
  ['experiment_levers', 'The levers available on a surface and where each transfers.', 'surface'],
  ['experiment_run', 'Paired Monte-Carlo; mean lift with a bootstrap 90% interval.', 'surface, levers, n'],
  ['experiment_list', 'Every experiment run in this workspace.', 'surface'],
  ['skill_list', 'The skill library with evidence and armed state.', 'surface'],
  ['skill_promote', 'Promote a passing experiment into an armed skill.', 'surface, levers'],
  ['skill_arm', 'Arm or disarm a skill.', 'skill_id, armed'],
  ['skill_transfer', 'Test a skill learned on one surface against another.', 'skill_id, to, n'],
  ['roi_report', 'Compounded lift of a surface library, with marginals.', 'surface, n'],
  ['roi_portfolio', 'roi_report across every surface at once.', 'n'],
  ['nudge_operator', 'Push a live suggestion into the operator console.', 'surface, text, urgency'],
];

function renderTools() {
  const list = S.serverTools
    ? S.serverTools.map(t => [t.name, t.description, Object.keys((t.inputSchema && t.inputSchema.properties) || {}).join(', ') || '—'])
    : FALLBACK_TOOLS;
  $('toolList').innerHTML = list.map(t => '<div class="tool"><div class="tn">' + t[0] + '</div>'
    + '<div class="td">' + esc(t[1]) + '</div><div class="ta">args: ' + esc(t[2]) + '</div></div>').join('');
}

async function probeMcp() {
  try {
    const r = await fetch('/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list' }),
    });
    const j = await r.json();
    if (!j.result || !j.result.tools) throw new Error('no tools');
    S.remote = true;
    S.serverTools = j.result.tools;
    $('mcpState').textContent = 'connected · ' + j.result.tools.length + ' tools';
    $('mcpState').className = 'pill ok';
    $('mcpEp').textContent = location.origin + '/mcp';
    renderTools();
  } catch {
    S.remote = false;
    $('mcpState').textContent = 'standalone · in-page engine';
    $('mcpState').className = 'pill';
  }
}

/* ══════════════════════════ floating AI companion ══════════════════════════
 * The overlay reads the same live session the console does. It is deliberately
 * a READER: it never mutates state, so it cannot break a run, and it can be
 * torn out without touching anything else.
 * ═══════════════════════════════════════════════════════════════════════════ */

function companionSource() {
  const s = S.ses;
  const surface = sf();
  if (!s) return { status: 'idle', vitals: {}, risks: [], cues: [], events: [] };

  const live = s.roster.filter(a => a.joinedAt <= s.t && a.leftAt === null);
  const st = E.stageAt(s.t / surface.stageUnit, s.stages);
  const m = E.metricsOf(s);

  const risks = live
    .filter(a => a.focus < 0.42)
    .map(a => ({
      a,
      hz: st.drop * surface.segments[a.segment].dropMult * (1.38 - a.focus) * 100,
    }))
    .sort((x, y) => y.hz - x.hz)
    .slice(0, 5)
    .map(({ a, hz }) => ({ who: displayName(a) + ' · ' + surface.segments[a.segment].label.toLowerCase(),
      val: hz.toFixed(2) + '%/t' }));

  // memory cues first - they are the ones with a head start on the event
  // Provenance is carried explicitly. Badging "not urgent" as "from memory" was
  // wrong twice over: it mislabels where a claim came from, which is the one
  // thing this console is not allowed to get wrong.
  const cues = [...s.nudges].reverse().slice(0, 6).map(n => ({
    id: n.id,
    at: n.ts,
    say: n.text,
    memory: !!n.memory,
    urgent: !n.memory && n.urgency === 'high',
    why: n.memory ? 'learned from earlier runs' : 'detected live',
  })).sort((a, b) => Number(b.memory) - Number(a.memory));

  const events = S.ticker.slice(0, 12).map(html => {
    const m2 = html.match(/>([^<]+)<\/span>\s*([^<]+)<span class="o">([^<]*)<\/span>\s*([^<]*)/);
    return m2 ? { ts: m2[1], type: m2[2].trim(), actor: m2[3], detail: m2[4].trim() } : null;
  }).filter(Boolean);

  return {
    status: s.done ? 'complete' : S.timer ? 'observing' : 'paused',
    vitals: {
      retention: s.peak ? live.length / s.peak : 0,
      focus: E.focusOf(s),
      live: live.length,
      peak: s.peak,
      outcomes: m.outcomes,
    },
    risks, cues, events,
  };
}

const companion = mountCompanion({
  trigger: '#btnCompanion',
  title: 'Backstage Companion',
  source: companionSource,
});

/* ════════════════════════════════ wiring ════════════════════════════════ */

function switchTab(name) {
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === name);
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === 'v-' + name);
  if (name === 'dataset') renderDataset();
  if (name === 'memory') renderMemory();
  if (name === 'mcp') { renderTools(); renderRpc(); }
}

function switchSurface(id) {
  S.surfaceId = id;
  selected.clear();
  renderLevers(); renderSkills(); renderMemory();
  $('transferOut').innerHTML = '';
  $('expResult').classList.add('hidden');
  $('expEmpty').classList.remove('hidden');
  $('roiBody').innerHTML = '<div class="empty big">Run a report to compare arms.</div>';
  newSession();
  start();
}

$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); };
$('surfSel').onchange = e => switchSurface(e.target.value);

for (const b of document.querySelectorAll('.spd')) {
  b.onclick = () => {
    document.querySelectorAll('.spd').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); S.speed = +b.dataset.spd;
    if (S.timer) { stop(); start(); }
  };
}

$('btnObserve').onclick = () => {
  S.anon = $('cAnon').checked;
  $('scrim').classList.add('gone');
  newSession(); start(); flashScan();
};
$('btnSkip').onclick = () => {
  S.anon = $('cAnon').checked;
  $('scrim').classList.add('gone');
  $('hud').style.display = 'none';
  $('recPill').classList.add('off');
  $('recPill').textContent = 'SILENT';
  newSession(); start();
};
$('btnReset').onclick = () => { newSession(); start(); };
$('dsFilter').onchange = renderDataset;
$('btnJsonl').onclick = () => {
  mcp('dataset_export', { format: 'jsonl' });
  download('backstage-' + S.surfaceId + '.jsonl', S.ses.dataset.map(r => JSON.stringify(r)).join('\n'), 'application/x-ndjson');
};
$('btnCsv').onclick = () => {
  mcp('dataset_export', { format: 'csv' });
  const head = 'ts,surface,type,actor,stage,focus,intent,tenure_s,cohort_retention,churn_next,outcome';
  const body = S.ses.dataset.map(r => [r.ts, r.surface, r.type, r.actor, r.stage,
    r.features.focus ?? '', r.features.intent ?? '', r.features.tenure_s ?? '',
    r.features.cohort_retention, r.label.churn_next ?? '', r.label.outcome ?? ''].join(','));
  download('backstage-' + S.surfaceId + '.csv', [head].concat(body).join('\n'), 'text/csv');
};
$('btnSeedMem').onclick = () => seedMemory(3);
$('btnForgetAll').onclick = () => { M.reset(); renderMemory(); renderBrief(); };
$('btnRun').onclick = runExperiment;
$('btnRetest').onclick = retestLibrary;
$('btnRoi').onclick = computeRoi;
$('btnPortfolio').onclick = computePortfolio;

/* surface pickers */
$('surfSel').innerHTML = SURFACE_LIST.map(s => '<option value="' + s.id + '">' + esc(s.label) + '</option>').join('');
$('surfPick').innerHTML = SURFACE_LIST.map((s, i) => '<button class="spick ' + (i === 0 ? 'on' : '') + '" data-id="' + s.id + '">'
  + '<b>' + esc(s.label) + '</b><span>' + esc(s.blurb) + '</span>'
  + '<i>' + s.cohort + ' ' + esc(s.actorPlural) + ' · ' + s.stages.length + ' stages · ' + esc(s.economics.outcomeNoun) + 's</i>'
  + '</button>').join('');
for (const b of $('surfPick').children) {
  b.onclick = () => {
    for (const x of $('surfPick').children) x.classList.remove('on');
    b.classList.add('on');
    S.surfaceId = b.dataset.id;
    renderLevers(); renderSkills(); applySurfaceChrome();
  };
}

applySurfaceChrome();
renderBrief();
renderMemory();
renderLevers();
renderSkills();
renderTools();
probeMcp();

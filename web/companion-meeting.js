/**
 * Mounts the floating companion inside the live WebRTC meeting room.
 *
 * IMPORTANT: every selector below was read off web/meeting-room.html, not
 * guessed. The first version of this file was written against web/meeting.js —
 * an orphaned copy of the meeting logic that nothing loads — so it looked for
 * `#topbar` (the live page uses `.topbar` as a CLASS) and a chat list that does
 * not exist there. It silently mounted its button onto <body>. Selectors are
 * asserted at mount time now, and anything missing is reported rather than
 * quietly degraded.
 *
 * The meeting page already computes real session state for its own stats bar.
 * Reading that is strictly better than re-deriving it: one source of truth, and
 * the companion cannot disagree with the page it floats over.
 */

import { Companion } from './companion.js';

/* Selectors, in one place, so a rename in the meeting room is a one-line fix. */
const SEL = {
  bar: '.topbar',
  grid: '#videoGrid',
  chat: '#panel-chat',
  timer: '#tbTimer',
  count: '#pCount',
  retention: '#st-retention',
  focus: '#st-focus',
  rows: '#st-rows',
  nudges: '#st-nudges',
};

const q = s => document.querySelector(s);
const txt = s => (q(s)?.textContent ?? '').trim();

/** "12:34" -> seconds. The page owns the clock; we just read it. */
function elapsedFromPage() {
  const t = txt(SEL.timer);
  const m = t.match(/(\d+):(\d+)/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/** Percent-ish strings ("87%", "0.87", "—") -> 0..1, or null when unknown. */
function frac(s) {
  if (!s || /^[—\-–]/.test(s)) return null;
  const n = parseFloat(s.replace('%', ''));
  if (!Number.isFinite(n)) return null;
  return s.includes('%') || n > 1 ? n / 100 : n;
}

const clock = sec => sec == null ? '--:--'
  : String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

// `fired` is a Map, not a Set: a cue keeps the timestamp it FIRED at. Rebuilding
// it every poll would make every cue claim it just happened.
const M = { started: null, peak: 0, events: [], joinedAt: new Map(), fired: new Map() };

const tiles = () => { const g = q(SEL.grid); return g ? [...g.children].filter(n => n.nodeType === 1) : []; };
const tileId = n => n.id || n.dataset?.socket || n.dataset?.id || 'peer';

function push(type, actor, detail) {
  M.events.unshift({ ts: clock(elapsedFromPage() ?? (Date.now() - (M.started ?? Date.now())) / 1000), type, actor, detail });
  if (M.events.length > 40) M.events.pop();
}

/* ─────────────────────────── real event sources ─────────────────────────── */

function watch() {
  const grid = q(SEL.grid);
  if (grid) {
    for (const t of tiles()) M.joinedAt.set(tileId(t), Date.now());
    M.peak = tiles().length;
    new MutationObserver(muts => {
      for (const mu of muts) {
        for (const n of mu.addedNodes) {
          if (n.nodeType !== 1) continue;
          M.joinedAt.set(tileId(n), Date.now());
          push('participant.join', tileId(n), '');
        }
        for (const n of mu.removedNodes) {
          if (n.nodeType !== 1) continue;
          const id = tileId(n);
          const at = M.joinedAt.get(id);
          push('participant.leave', id, at ? 'dwell ' + clock((Date.now() - at) / 1000) : '');
          M.joinedAt.delete(id);
        }
      }
      M.peak = Math.max(M.peak, tiles().length);
    }).observe(grid, { childList: true });
  }

  const chat = q(SEL.chat);
  if (chat) {
    new MutationObserver(muts => {
      for (const mu of muts) for (const n of mu.addedNodes) {
        if (n.nodeType !== 1) continue;
        const t = (n.textContent || '').trim();
        if (t) push('chat.message', '', t.slice(0, 44));
      }
    }).observe(chat, { childList: true, subtree: true });
  }
}

/* ──────────────────────────────── source ──────────────────────────────── */

function source() {
  const live = tiles().length || parseInt(txt(SEL.count), 10) || 0;
  M.peak = Math.max(M.peak, live);
  const sec = elapsedFromPage() ?? (M.started ? (Date.now() - M.started) / 1000 : 0);
  const mins = sec / 60;

  // Prefer what the page already computed; fall back to what we can observe.
  const retention = frac(txt(SEL.retention)) ?? (M.peak ? live / M.peak : 1);
  const focus = frac(txt(SEL.focus));

  /*
   * Cues are limited to what a browser can honestly observe in this build:
   * presence, dwell and elapsed time. There is no transcript here, so there is
   * no claim about what was said. Each cue fires once — a companion that
   * repeats itself every 500ms gets muted in the first real meeting.
   */
  const cues = [];
  const add = (id, say, why, urgent) => {
    if (!M.fired.has(id)) M.fired.set(id, { id, at: clock(sec), say, why, urgent });
    cues.push(M.fired.get(id));
  };

  const leaves = M.events.filter(e => e.type === 'participant.leave').length;
  if (leaves >= 2 && live > 0) {
    add('cue:leaves:' + Math.min(leaves, 6),
      `${leaves} people have left. Check whether the last few minutes lost the room.`,
      'observed from real join/leave events', leaves >= 4);
  }
  if (mins >= 25 && live > 1) {
    add('cue:long:' + Math.floor(mins / 10),
      'Past 25 minutes. Attention usually falls here — take a question or change format.',
      'elapsed time only; no transcript in this build', false);
  }
  if (M.peak >= 3 && live <= Math.ceil(M.peak / 2) && M.peak > 1) {
    add('cue:half:' + M.peak,
      `Room is down to ${live} of a peak of ${M.peak}. Worth naming it and resetting.`,
      'real participant tiles', true);
  }

  return {
    status: M.started ? 'observing' : 'idle',
    vitals: { live, peak: M.peak, retention, focus, outcomes: 0 },
    risks: [],
    cues: cues.slice(-3).reverse(),
    events: M.events.slice(0, 12),
  };
}

/* ─────────────────────────────── mount ─────────────────────────────── */

export function initMeetingCompanion() {
  const bar = q(SEL.bar);
  if (!bar) {
    // Loud, not silent: a missing mount point means the page changed under us.
    console.warn('[companion] mount point "' + SEL.bar + '" not found — appending to body. '
      + 'Update SEL in web/companion-meeting.js if the meeting room was restructured.');
  }
  const missing = Object.entries(SEL).filter(([, s]) => !q(s)).map(([k]) => k);
  if (missing.length) console.info('[companion] optional hooks absent: ' + missing.join(', '));

  const btn = document.createElement('button');
  btn.id = 'btnCompanionMeeting';
  btn.type = 'button';
  btn.textContent = '⬡ AI Companion';
  btn.style.cssText = 'background:rgba(43,179,166,.14);color:#2bb3a6;border:1px solid rgba(43,179,166,.42);'
    + 'border-radius:8px;padding:7px 13px;font:inherit;font-size:12.5px;font-weight:600;'
    + 'cursor:pointer;white-space:nowrap;margin-left:8px';
  (bar || document.body).appendChild(btn);

  const c = new Companion({ title: 'Meeting Companion', source });
  btn.addEventListener('click', () => {
    if (c.state !== 'dormant') return;
    M.started = Date.now();
    watch();
    push('companion.start', 'companion', 'observing this room');
    c.boot();
    btn.disabled = true;
    btn.textContent = '⬡ Companion online';
    btn.style.opacity = '.6';
    btn.style.cursor = 'default';
  });
  return c;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMeetingCompanion);
} else {
  initMeetingCompanion();
}

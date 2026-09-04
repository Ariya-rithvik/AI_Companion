/**
 * integrations/events.mjs — Real Event Bridge
 *
 * Bridges real Socket.io meeting room events into Backstage's observation pipeline.
 * When a REAL participant joins/leaves/speaks in a meeting room, this module
 * creates properly-formatted observation rows — the same schema the engine uses
 * for simulated rows — so the Dataset, Experiments, and Skills tabs work with
 * real data instead of Monte Carlo simulations.
 *
 * Flow:
 *   Socket.io event (server/realtime.mjs)
 *     → mapToObservation()       ← here
 *     → injectIntoSession()      ← here
 *     → session.dataset[]        ← engine/core.mjs schema
 *     → web UI Dataset tab       ← no code change needed there
 *
 * Why this matters: the engine's finalize() back-fills labels when the session
 * closes, making the rows trainable. Real data means the ROI numbers are from
 * actual meetings, not calibrated constants.
 */

import { fmtClock, stageAt, focusOf } from '../engine/core.mjs';

// ── Event type mapping ────────────────────────────────────────────────────
// Maps Socket.io event names to the engine's canonical event types.
// The engine expects these specific string values (set per surface).
const EVENT_MAP = {
  // Meeting room events (server/realtime.mjs emits these)
  participant_joined:  'join',
  participant_left:    'leave',
  participant_speaking: 'signal',  // mic active = engagement signal
  participant_reacted: 'react',
  chat_message:        'signal',   // chat = engagement signal
  screen_share_start:  'deep',     // screen share = deep interaction
  hand_raised:         'signal',

  // Canvas collaboration events (from your canvas repo)
  canvas_draw:         'signal',   // drawing = engagement
  canvas_tool_change:  'signal',
};

// ── Focus heuristics for real participants ────────────────────────────────
// We can't read "focus" from a real person's brain, so we estimate it
// from observable behaviors: speaking time, reactions, chat frequency.
const computeFocus = (participant) => {
  const {
    speakingSeconds = 0,
    reactionCount = 0,
    chatCount = 0,
    joinedAt,
    now = Date.now(),
  } = participant;

  const durationMs = now - joinedAt;
  const durationMin = Math.max(1, durationMs / 60000);

  // Engagement rate: how active relative to time in session
  const speakingRate = Math.min(1, (speakingSeconds / 60) / durationMin);
  const reactionRate = Math.min(1, reactionCount / (durationMin * 2));
  const chatRate = Math.min(1, chatCount / (durationMin * 1.5));

  // Weighted focus score (0–1)
  const focus = Math.min(1, Math.max(0.1,
    0.5 * speakingRate + 0.3 * reactionRate + 0.2 * chatRate
  ));

  return parseFloat(focus.toFixed(4));
};

// ── Intent heuristics ────────────────────────────────────────────────────
const computeIntent = (participant) => {
  const { reactionCount = 0, chatCount = 0, screenShareCount = 0, handRaisedCount = 0 } = participant;
  const engagementTotal = reactionCount + chatCount * 1.5 + screenShareCount * 3 + handRaisedCount * 2;
  return parseFloat(Math.min(1, Math.max(0, engagementTotal / 15)).toFixed(4));
};

// ── Map a real Socket.io event to an observation row ─────────────────────
/**
 * @param {object} session   - Engine session object (has .dataset, .surface, etc.)
 * @param {string} eventName - Socket.io event name
 * @param {object} data      - Event payload from the socket
 * @param {object} roomState - Current room snapshot (all participants)
 * @returns {object}         - Observation row in engine schema
 */
export function mapToObservation(session, eventName, data, roomState) {
  const sf = session.surface;
  const now = session.t; // engine clock ticks, not wall time
  const engineEventType = EVENT_MAP[eventName] ?? eventName;

  const allParticipants = Object.values(roomState.participants || {});
  const activeCount = allParticipants.filter(p => p.active).length;
  const peak = Math.max(session.peak || 0, activeCount);

  // Compute aggregate focus from real participants
  const avgFocus = activeCount > 0
    ? allParticipants.filter(p => p.active)
        .reduce((sum, p) => sum + computeFocus(p), 0) / activeCount
    : 0;

  const participant = data.participantId ? roomState.participants[data.participantId] : null;
  const actorFocus = participant ? computeFocus(participant) : avgFocus;
  const actorIntent = participant ? computeIntent(participant) : 0.5;

  const pos = now / sf.stageUnit;
  const stage = stageAt(pos, session.stages);

  const cohortRetention = session.peak > 0
    ? parseFloat((activeCount / session.peak).toFixed(4))
    : 1;

  // Build the row in the exact schema engine/core.mjs uses
  const row = {
    seq: session.dataset.length,
    t: now,
    ts: fmtClock(sf, now),
    session_id: session.id,
    surface: sf.id,
    type: engineEventType,
    actor: data.participantId || data.socketId || 'unknown',
    stage: stage.id,
    source: 'real',  // ← marks this as REAL data, not simulated
    payload: {
      name: data.name || data.participantId || 'Participant',
      segment: data.segment || 'standard',
      event: eventName,
      ...data.payload,
    },
    features: {
      stage_idx: session.stages.indexOf(stage),
      cohort_focus: parseFloat(avgFocus.toFixed(4)),
      cohort_retention: cohortRetention,
      concurrent: activeCount,
      position: parseFloat(pos.toFixed(2)),
      interactive_stage: stage.interactive ? 1 : 0,
      levers: session.levers.map(l => l.id),
      // Real engagement features (not simulated)
      focus: actorFocus,
      intent: actorIntent,
      speaking_seconds: participant?.speakingSeconds ?? 0,
      reaction_count: participant?.reactionCount ?? 0,
      chat_count: participant?.chatCount ?? 0,
      is_real: true,  // ← flag so UI can show "REAL" badge
    },
    label: {
      churn_next: null,   // back-filled when session closes
      outcome: null,      // back-filled when session closes
    },
  };

  return row;
}

// ── Inject a real event into a running session ───────────────────────────
/**
 * Adds the mapped observation row to the session dataset.
 * Also updates session peak and focus tracking, just like tick() does.
 *
 * @param {object} session   - Engine session object
 * @param {string} eventName - Socket.io event name
 * @param {object} data      - Event payload
 * @param {object} roomState - Current room snapshot
 * @returns {object}         - The emitted row
 */
export function injectIntoSession(session, eventName, data, roomState) {
  const allParticipants = Object.values(roomState.participants || {});
  const activeCount = allParticipants.filter(p => p.active).length;

  // Update peak — real participants can exceed simulated cohort
  session.peak = Math.max(session.peak || 0, activeCount);

  const row = mapToObservation(session, eventName, data, roomState);
  session.dataset.push(row);

  // Track participant leave for label back-filling
  if (eventName === 'participant_left' && data.participantId) {
    // Mark this participant's rows so finalize() can back-fill churn labels
    // We store a simple map on the session for the real participants
    if (!session.realLeaveAt) session.realLeaveAt = new Map();
    session.realLeaveAt.set(data.participantId, session.t);
  }

  return row;
}

// ── Build a participant object for the room state ─────────────────────────
/**
 * Creates a new participant entry for the room state map.
 * Called from server/realtime.mjs when someone joins.
 */
export function createParticipant(socketId, joinData) {
  return {
    id: socketId,
    name: joinData.name || 'Participant',
    segment: joinData.segment || 'standard',
    active: true,
    joinedAt: Date.now(),
    // Engagement counters — incremented as events arrive
    speakingSeconds: 0,
    reactionCount: 0,
    chatCount: 0,
    screenShareCount: 0,
    handRaisedCount: 0,
    // Metadata
    camera: joinData.camera ?? false,
    mic: joinData.mic ?? false,
  };
}

// ── Back-fill labels when a real session ends ─────────────────────────────
/**
 * Same logic as engine/core.mjs finalize() but for real participants.
 * Called from server/realtime.mjs when all participants leave.
 */
export function finalizeRealSession(session, roomState) {
  const churnWindow = session.surface.churnWindow * session.surface.stageUnit;
  const leaveMap = session.realLeaveAt ?? new Map();

  for (const row of session.dataset) {
    if (row.source !== 'real') continue; // let engine finalize() handle simulated rows
    const leftAt = leaveMap.get(row.actor);
    if (leftAt !== undefined) {
      row.label.churn_next = leftAt !== null && leftAt - row.t <= churnWindow && leftAt >= row.t ? 1 : 0;
    }
    // Outcome = did the participant stay through the outcome gate?
    const participant = roomState.participants[row.actor];
    if (participant) {
      const gate = session.surface.outcomeGate * session.surface.stageUnit;
      row.label.outcome = participant.active || (participant.leftAt > gate) ? 1 : 0;
    }
  }
}

// ── Burst detector for real events ───────────────────────────────────────
/**
 * Tracks recent leave events and returns true if a burst threshold is exceeded.
 * Used by server/realtime.mjs to decide when to trigger AI nudges.
 */
export class BurstDetector {
  constructor(windowSize = 4, threshold = 3) {
    this.window = [];
    this.windowSize = windowSize;
    this.threshold = threshold;
  }

  /** Call on every participant_left. Returns true if burst detected. */
  record(count = 1) {
    this.window.push(count);
    if (this.window.length > this.windowSize) this.window.shift();
    const total = this.window.reduce((a, b) => a + b, 0);
    if (total >= this.threshold) {
      this.window = []; // reset after detecting
      return true;
    }
    return false;
  }
}

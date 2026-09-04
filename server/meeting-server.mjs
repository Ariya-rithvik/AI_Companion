/**
 * server/meeting-server.mjs
 *
 * Real Meeting Server — adapted from the canvas repo's socket/socketHandler.js
 * (github.com/VENKATARAMANA-T/Real-Time-Collaborative-Digital-Canvas)
 *
 * What this does:
 *  - Hosts a real Socket.io room where 6 browser tabs can join
 *  - Each tab is a real participant with a name, audio (VAD), chat, reactions
 *  - Every event (join, speak, react, chat, leave) is recorded into a dataset row
 *  - AI companion watches the room and fires nudges when engagement drops
 *  - After meeting ends → dataset is finalized with churn/outcome labels
 *  - ROI calculation: (nudged_outcomes - baseline_outcomes) / baseline_cost
 *
 * Room state per meeting:
 *   participants: Map<socketId, Participant>
 *   dataset:      ObservationRow[]   ← grows in real-time
 *   nudges:       NudgeRecord[]
 *   aiCompanion:  { active, model, provider }
 */

import { Server as SocketIO } from 'socket.io';
import { analyzeSession, generateNudge } from '../integrations/llm.mjs';

// ── In-memory store: meetingId → MeetingRoom ──────────────────────────────
export const rooms = new Map();

/** Create a new meeting room */
export function createRoom(meetingId, password, hostName, surface = 'webinar') {
  const room = {
    meetingId,
    password,
    surface,
    hostName,
    hostSocketId: null,
    participants: new Map(),  // socketId → Participant
    dataset: [],              // observation rows (real data, not simulated)
    nudges: [],               // AI nudge records
    chatMessages: [],
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    peakCount: 0,
    aiCompanion: { active: true, nudgesGenerated: 0 },
    // Burst detection: track recent leaves
    _recentLeaves: [],
  };
  rooms.set(meetingId, room);
  return room;
}

/** Attach the Socket.io namespace to an existing HTTP server */
export function attachMeetingServer(httpServer) {
  const io = new SocketIO(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/meeting-socket',    // separate from realtime.mjs which uses /socket.io
  });

  io.on('connection', socket => {
    console.log(`[meeting] socket connected: ${socket.id}`);

    // ── CREATE MEETING ──────────────────────────────────────────────────
    // Host creates a room → gets meetingId + password to share with others
    socket.on('create_meeting', ({ hostName, password, surface }, ack) => {
      const meetingId = 'BS-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      const pwd = password || Math.random().toString(36).slice(2, 6).toUpperCase();
      const room = createRoom(meetingId, pwd, hostName, surface || 'webinar');
      console.log(`[meeting] room created: ${meetingId} by ${hostName}`);
      if (ack) ack({ ok: true, meetingId, password: pwd });
    });

    // ── JOIN MEETING ────────────────────────────────────────────────────
    // From canvas repo: join_meeting → socket.join(meetingId), broadcast user_joined
    socket.on('join_meeting', ({ meetingId, password, name, role = 'attendee' }, ack) => {
      const room = rooms.get(meetingId);
      if (!room) return ack?.({ ok: false, error: 'Meeting not found' });
      if (room.password && password !== room.password) {
        return ack?.({ ok: false, error: 'Wrong password' });
      }

      socket.join(meetingId);

      // The create screen uses a short-lived socket to reserve credentials;
      // the first successful join is the host's live socket.
      if (!room.hostSocketId) room.hostSocketId = socket.id;

      // Store participant
      const participant = {
        socketId: socket.id,
        name,
        role,
        joinedAt: Date.now(),
        leftAt: null,
        active: true,
        // Engagement counters (updated as events arrive)
        speakingMs: 0,
        speakStart: null,
        reactionCount: 0,
        chatCount: 0,
        handRaised: 0,
      };
      room.participants.set(socket.id, participant);

      // Track peak
      const activeCount = [...room.participants.values()].filter(p => p.active).length;
      room.peakCount = Math.max(room.peakCount, activeCount);

      // Record to dataset (REAL observation row)
      const row = makeRow(room, 'join', socket.id, participant, { name, role });
      recordRow(io, room, row);

      // Broadcast join to room — exactly from canvas repo
      socket.to(meetingId).emit('user_joined', { socketId: socket.id, name, role });

      // Reply to joiner with room state
      const others = [...room.participants.entries()]
        .filter(([id]) => id !== socket.id)
        .map(([id, p]) => ({ socketId: id, name: p.name, role: p.role }));

      ack?.({
        ok: true,
        meetingId,
        participants: others,
        chatHistory: room.chatMessages.slice(-30),
        dataset: room.dataset,    // give them the live dataset
        nudges: room.nudges,
        isHost: room.hostSocketId === socket.id,
      });

      console.log(`[meeting] ${name} joined ${meetingId} (${activeCount} total)`);

      // If first join → start room timer
      if (!room.startedAt) room.startedAt = Date.now();

      // Notify AI companion
      maybeNudge(io, room, socket.id);
    });

    // ── WebRTC SIGNALING — from canvas repo pattern ───────────────────
    socket.on('webrtc_offer',         ({ to, offer })     => socket.to(to).emit('webrtc_offer',         { from: socket.id, offer }));
    socket.on('webrtc_answer',        ({ to, answer })    => socket.to(to).emit('webrtc_answer',        { from: socket.id, answer }));
    socket.on('webrtc_ice_candidate', ({ to, candidate }) => socket.to(to).emit('webrtc_ice_candidate', { from: socket.id, candidate }));

    // ── MEDIA STATE ───────────────────────────────────────────────────
    socket.on('media_state', ({ camera, mic }) => {
      const room = getRoomFor(socket.id);
      if (!room) return;
      const p = room.participants.get(socket.id);
      if (p) { p.camera = camera; p.mic = mic; }
      socket.to(room.meetingId).emit('participant_media_state', { socketId: socket.id, camera, mic });
    });

    // ── SPEAKING (Voice Activity Detection) ───────────────────────────
    // From canvas repo: VAD in browser → emits speaking events
    socket.on('speaking', ({ speaking }) => {
      const room = getRoomFor(socket.id);
      if (!room) return;
      const p = room.participants.get(socket.id);
      if (!p) return;

      if (speaking) {
        p.speakStart = Date.now();
      } else if (p.speakStart) {
        p.speakingMs += Date.now() - p.speakStart;
        p.speakStart = null;
      }

      // Broadcast speaking indicator
      socket.to(room.meetingId).emit('participant_speaking', { socketId: socket.id, speaking, name: p.name });

      // Record engagement signal in dataset
      if (speaking) {
        recordRow(io, room, makeRow(room, 'speaking', socket.id, p, {}));
      }
    });

    // ── CHAT ──────────────────────────────────────────────────────────
    // From canvas repo: chatSocket pattern
    socket.on('send_message', ({ meetingId, text }) => {
      const room = rooms.get(meetingId);
      if (!room) return;
      const p = room.participants.get(socket.id);
      if (!p) return;

      p.chatCount++;
      const msg = {
        id: 'msg_' + Date.now(),
        socketId: socket.id,
        name: p.name,
        text,
        ts: new Date().toISOString(),
      };
      room.chatMessages.push(msg);
      if (room.chatMessages.length > 500) room.chatMessages.shift();

      // Emit to everyone in room
      io.to(meetingId).emit('new_message', msg);

      // Dataset row
      recordRow(io, room, makeRow(room, 'chat', socket.id, p, { text: text.slice(0, 100) }));
    });

    // ── REACTIONS ────────────────────────────────────────────────────
    socket.on('react', ({ emoji }) => {
      const room = getRoomFor(socket.id);
      if (!room) return;
      const p = room.participants.get(socket.id);
      if (!p) return;

      p.reactionCount++;
      io.to(room.meetingId).emit('user_reacted', { socketId: socket.id, name: p.name, emoji });
      recordRow(io, room, makeRow(room, 'react', socket.id, p, { emoji }));
    });

    // ── RAISE HAND ────────────────────────────────────────────────────
    socket.on('raise_hand', () => {
      const room = getRoomFor(socket.id);
      if (!room) return;
      const p = room.participants.get(socket.id);
      if (!p) return;
      p.handRaised++;
      io.to(room.meetingId).emit('hand_raised', { socketId: socket.id, name: p.name });
      recordRow(io, room, makeRow(room, 'hand_raised', socket.id, p, {}));
    });

    // ── HOST CONTROLS ─────────────────────────────────────────────────
    socket.on('host_control', async ({ action, targetSocketId, meetingId }) => {
      const room = rooms.get(meetingId);
      if (!room || room.hostSocketId !== socket.id) return;

      switch (action) {
        case 'mute_all':
          io.to(meetingId).emit('muted_by_host');
          break;
        case 'kick':
          if (targetSocketId) {
            io.to(targetSocketId).emit('kicked_by_host');
          }
          break;
        case 'ai_nudge': {
          // Host manually requests an AI nudge
          const nudge = await generateNudgeForRoom(room);
          io.to(meetingId).emit('ai_nudge', nudge);
          room.nudges.push({ ...nudge, requestedBy: 'host', t: Date.now() });
          break;
        }
        case 'end_meeting': {
          finalizeRoom(room);
          emitMeetingEnd(io, room);
          break;
        }
      }
    });

    // ── LEAVE MEETING ─────────────────────────────────────────────────
    // From canvas repo: leave_meeting event + auto on disconnect
    socket.on('leave_meeting', ({ meetingId } = {}) => {
      handleLeave(socket, io, meetingId);
    });

    socket.on('disconnect', () => {
      handleLeave(socket, io);
    });
  });

  console.log('[meeting-server] attached on path /meeting-socket');
  return io;
}

// ── Helper: handle participant leave ──────────────────────────────────────
function handleLeave(socket, io, explicitMeetingId) {
  const room = explicitMeetingId ? rooms.get(explicitMeetingId) : getRoomFor(socket.id);
  if (!room) return;

  const p = room.participants.get(socket.id);
  if (!p || !p.active) return;

  p.active = false;
  p.leftAt = Date.now();
  if (p.speakStart) { p.speakingMs += Date.now() - p.speakStart; p.speakStart = null; }

  // Dataset row
  recordRow(io, room, makeRow(room, 'leave', socket.id, p, {
    speakingMs: p.speakingMs,
    reactionCount: p.reactionCount,
    chatCount: p.chatCount,
  }));

  // Track recent leaves for burst detection
  room._recentLeaves.push(Date.now());
  room._recentLeaves = room._recentLeaves.filter(t => Date.now() - t < 30000);

  // Broadcast to room — from canvas repo pattern
  socket.to(room.meetingId).emit('user_left', { socketId: socket.id, name: p.name });

  const activeCount = [...room.participants.values()].filter(x => x.active).length;
  console.log(`[meeting] ${p.name} left ${room.meetingId} (${activeCount} remaining)`);

  // Burst detection → auto AI nudge to host
  if (room._recentLeaves.length >= 2 && room.aiCompanion.active) {
    generateNudgeForRoom(room).then(nudge => {
      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit('ai_nudge', nudge);
      }
      room.nudges.push({ ...nudge, trigger: 'burst', t: Date.now() });
    }).catch(() => {});
  }

  // If all left → finalize
  if (activeCount === 0) {
    finalizeRoom(room);
    emitMeetingEnd(io, room);
  }
}

function emitMeetingEnd(io, room) {
  const summary = buildSummary(room);
  io.to(room.meetingId).emit('meeting_ended', { dataset: room.dataset, summary });
  analyzeSession({
    surface: room.surface,
    metrics: {
      retention: summary.retentionRate,
      outcomes: summary.retainedParticipants,
      outcome_rate: summary.retentionRate,
      roi: Number(summary.estimatedROI.replace('%', '')) / 100,
      avg_dwell: Number(summary.durationMin),
    },
    topNudges: room.nudges,
    moments: [],
    leversUsed: [],
  }).then(analysis => io.to(room.meetingId).emit('meeting_analysis', analysis)).catch(() => {});
}

// ── Helper: find which room a socket is in ────────────────────────────────
function getRoomFor(socketId) {
  for (const room of rooms.values()) {
    if (room.participants.has(socketId)) return room;
  }
  return null;
}

function recordRow(io, room, row) {
  room.dataset.push(row);
  io.to(room.meetingId).emit('dataset_row', row);
}

// ── Build a real observation row (same schema as engine/core.mjs) ─────────
let rowSeq = 0;
function makeRow(room, type, socketId, participant, extra) {
  const activeCount = [...room.participants.values()].filter(p => p.active).length;
  const retention = room.peakCount > 0 ? activeCount / room.peakCount : 1;
  const elapsedMin = (Date.now() - (room.startedAt || room.createdAt)) / 60000;

  // Focus heuristic based on engagement signals
  const focus = computeFocus(participant, elapsedMin);

  return {
    seq: rowSeq++,
    t: elapsedMin,                    // meeting time in minutes
    ts: new Date().toISOString(),
    session_id: room.meetingId,
    surface: room.surface,
    type,                             // join | leave | chat | react | speaking | hand_raised
    actor: socketId,
    actor_name: participant?.name || 'unknown',
    stage: getStage(elapsedMin),      // intro | main | qa | closing
    source: 'real',                   // NOT simulated
    payload: extra || {},
    features: {
      concurrent: activeCount,
      cohort_retention: parseFloat(retention.toFixed(4)),
      cohort_focus: parseFloat(focus.toFixed(4)),
      elapsed_min: parseFloat(elapsedMin.toFixed(2)),
      speaking_ms: participant?.speakingMs || 0,
      reactions: participant?.reactionCount || 0,
      chats: participant?.chatCount || 0,
      is_host: socketId === room.hostSocketId,
      is_real: true,
    },
    label: {
      churn_next: null,   // back-filled at session end
      outcome: null,      // back-filled at session end
    },
  };
}

// ── Focus heuristic for real participants ─────────────────────────────────
function computeFocus(p, elapsedMin) {
  if (!p) return 0.5;
  const minElapsed = Math.max(1, elapsedMin);
  const speakMin = (p.speakingMs || 0) / 60000;
  const speakRate = Math.min(1, speakMin / minElapsed);
  const reactRate = Math.min(1, (p.reactionCount || 0) / (minElapsed * 3));
  const chatRate  = Math.min(1, (p.chatCount || 0) / (minElapsed * 2));
  return Math.max(0.1, Math.min(1, 0.5 * speakRate + 0.3 * reactRate + 0.2 * chatRate));
}

// ── Meeting stage by elapsed time ─────────────────────────────────────────
function getStage(elapsedMin) {
  if (elapsedMin < 5) return 'intro';
  if (elapsedMin < 25) return 'main';
  if (elapsedMin < 35) return 'qa';
  return 'closing';
}

// ── Back-fill churn/outcome labels at session end ─────────────────────────
function finalizeRoom(room) {
  if (room.endedAt) return;
  room.endedAt = Date.now();
  const durationMin = (room.endedAt - (room.startedAt || room.createdAt)) / 60000;

  for (const row of room.dataset) {
    const p = room.participants.get(row.actor);
    if (!p) continue;

    // churn_next: did this person leave within the next 5 minutes?
    const leftAtMin = p.leftAt ? (p.leftAt - (room.startedAt || room.createdAt)) / 60000 : durationMin + 1;
    row.label.churn_next = leftAtMin - row.t < 5 && p.leftAt !== null ? 1 : 0;

    // outcome: stayed through 80% of the session
    const outcomeGate = durationMin * 0.8;
    row.label.outcome = leftAtMin >= outcomeGate ? 1 : 0;
  }
}

// ── Build ROI summary ─────────────────────────────────────────────────────
function buildSummary(room) {
  const total = room.participants.size;
  const stayed = [...room.participants.values()].filter(p => {
    const durationMin = (room.endedAt - room.startedAt) / 60000;
    const leftMin = p.leftAt ? (p.leftAt - room.startedAt) / 60000 : durationMin;
    return leftMin >= durationMin * 0.8;
  }).length;

  const retentionRate = total > 0 ? stayed / total : 0;
  const totalReactions = [...room.participants.values()].reduce((s, p) => s + p.reactionCount, 0);
  const totalChats = [...room.participants.values()].reduce((s, p) => s + p.chatCount, 0);
  const avgFocusRows = room.dataset.filter(r => r.type === 'join' || r.type === 'speaking');
  const avgFocus = avgFocusRows.length > 0
    ? avgFocusRows.reduce((s, r) => s + r.features.cohort_focus, 0) / avgFocusRows.length
    : 0;

  // ROI: nudge-based improvement model (from real prototype: 6-8% improvement)
  const nudgesActed = room.nudges.filter(n => n.acted).length;
  const baselineRetention = 0.65; // industry benchmark
  const nudgedImprovement = nudgesActed * 0.015; // each nudge = +1.5% retention
  const roi = ((retentionRate - baselineRetention) / baselineRetention + nudgedImprovement) * 100;

  return {
    meetingId: room.meetingId,
    surface: room.surface,
    durationMin: room.endedAt ? ((room.endedAt - room.startedAt) / 60000).toFixed(1) : 0,
    totalParticipants: total,
    peakParticipants: room.peakCount,
    retainedParticipants: stayed,
    retentionRate: parseFloat(retentionRate.toFixed(4)),
    retentionPct: (retentionRate * 100).toFixed(1) + '%',
    avgFocus: parseFloat(avgFocus.toFixed(4)),
    totalMessages: totalChats,
    totalReactions,
    nudgesGenerated: room.nudges.length,
    nudgesActed,
    datasetRows: room.dataset.length,
    estimatedROI: roi.toFixed(1) + '%',
    // Breakdown for the ROI tab
    roiBreakdown: {
      baselineRetention: '65.0%',
      actualRetention: (retentionRate * 100).toFixed(1) + '%',
      retentionLift: ((retentionRate - 0.65) * 100).toFixed(1) + '%',
      nudgeImpact: (nudgedImprovement * 100).toFixed(1) + '%',
      totalROI: roi.toFixed(1) + '%',
    },
  };
}

// ── AI nudge generation for a live room ───────────────────────────────────
async function generateNudgeForRoom(room) {
  const active = [...room.participants.values()].filter(p => p.active);
  const activeCount = active.length;
  const retention = room.peakCount > 0 ? activeCount / room.peakCount : 1;
  const elapsedMin = (Date.now() - (room.startedAt || room.createdAt)) / 60000;
  const avgFocus = active.length > 0
    ? active.reduce((s, p) => s + computeFocus(p, elapsedMin), 0) / active.length
    : 0.5;

  const result = await generateNudge({
    surface: room.surface,
    stage: getStage(elapsedMin),
    stageLabel: getStage(elapsedMin),
    focus: avgFocus,
    retention,
    concurrent: activeCount,
    peak: room.peakCount,
    dropCount: room._recentLeaves.length,
    topReason: 'engagement declined',
    availableLevers: ['Ask a poll question', 'Break into discussion', 'Share key insight', 'Call for questions'],
    triggerType: 'burst',
  });

  room.aiCompanion.nudgesGenerated++;
  return result;
}

// ── Proactive nudge check when someone joins ──────────────────────────────
async function maybeNudge(io, room, newSocketId) {
  // Only nudge if there are 3+ people and host is present
  if (room.participants.size < 3) return;
  if (!room.hostSocketId) return;

  // Nudge at the start of each stage transition
  const elapsedMin = (Date.now() - (room.startedAt || room.createdAt)) / 60000;
  const stage = getStage(elapsedMin);

  // First nudge at stage start
  if (stage === 'main' && elapsedMin < 6 && room.nudges.filter(n => n.trigger === 'stage:main').length === 0) {
    const nudge = await generateNudgeForRoom(room).catch(() => null);
    if (nudge) {
      io.to(room.hostSocketId).emit('ai_nudge', nudge);
      room.nudges.push({ ...nudge, trigger: 'stage:main', t: Date.now() });
    }
  }
}

// ── REST: list rooms ───────────────────────────────────────────────────────
export function listRooms() {
  return [...rooms.values()].map(r => ({
    meetingId: r.meetingId,
    hostName: r.hostName,
    surface: r.surface,
    participants: [...r.participants.values()].filter(p => p.active).map(p => p.name),
    participantCount: [...r.participants.values()].filter(p => p.active).length,
    datasetRows: r.dataset.length,
    nudges: r.nudges.length,
    createdAt: new Date(r.createdAt).toISOString(),
    hasEnded: !!r.endedAt,
  }));
}

export function getRoom(meetingId) {
  return rooms.get(meetingId);
}

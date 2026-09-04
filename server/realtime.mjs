/**
 * server/realtime.mjs — Real Socket.io Meeting Server
 *
 * This is the heart of the real meeting system, adapted from the pattern used
 * in the Real-Time-Collaborative-Digital-Canvas repo (your canvas project).
 *
 * What it does:
 *   1. Hosts real WebRTC meeting rooms — participants join with camera/mic
 *   2. Handles WebRTC signaling (offer/answer/ICE candidates) between browsers
 *   3. Maps every participant event into the Backstage observation pipeline
 *   4. Triggers real AI nudges (via integrations/llm.mjs) on detected patterns
 *   5. Manages room state: who is present, their engagement signals, focus scores
 *
 * Architecture (matches your canvas repo's backend pattern):
 *
 *   Browser A ──WebRTC offer──→ Socket.io signaling ──→ Browser B
 *              ←─ICE candidates─                   ←──
 *
 *   Browser ──join/leave/react──→ realtime.mjs
 *                                      ↓
 *                            integrations/events.mjs
 *                                      ↓
 *                            session.dataset[] (real rows)
 *
 * Usage: imported by server/mcp.mjs and attached to the same HTTP server.
 */

import { Server as SocketIO } from 'socket.io';
import { createParticipant, injectIntoSession, BurstDetector } from '../integrations/events.mjs';
import { createMeetingCredentials, ICE_SERVERS } from '../integrations/zoom.mjs';
import { generateNudge, streamChat, buildChatMessages } from '../integrations/llm.mjs';

// ── Room state ─────────────────────────────────────────────────────────────
// rooms: Map<meetingId, RoomState>
// RoomState = { meetingId, hostId, surface, participants, session, burstDetector, createdAt }
const rooms = new Map();

// ── Attach Socket.io to an existing HTTP server ───────────────────────────
export function attachRealtime(httpServer, sessionStore) {
  const io = new SocketIO(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    // Transports: websocket preferred, polling fallback
    transports: ['websocket', 'polling'],
  });

  // ── Namespace: /meeting — real video meeting rooms ─────────────────────
  const meetingNS = io.of('/meeting');

  meetingNS.on('connection', socket => {
    console.log(`[realtime] socket connected: ${socket.id}`);
    let currentRoom = null;
    let currentMeetingId = null;

    // ── CREATE MEETING ────────────────────────────────────────────────────
    // Called by the host when they start a new meeting room.
    socket.on('create_meeting', (data, ack) => {
      const credentials = createMeetingCredentials(data.hostName, data.surface || 'webinar');
      const room = {
        meetingId: credentials.meetingId,
        password: credentials.password,
        shareToken: credentials.shareToken,
        hostId: socket.id,
        surface: credentials.surface,
        participants: {},
        session: sessionStore.get(credentials.surface) ?? null,
        burstDetector: new BurstDetector(4, 3),
        chatMessages: [],
        settings: {
          chatEnabled: true,
          videoEnabled: true,
          audioEnabled: true,
        },
        createdAt: new Date().toISOString(),
      };

      rooms.set(credentials.meetingId, room);
      console.log(`[realtime] meeting created: ${credentials.meetingId} by ${data.hostName}`);
      ack({ ok: true, credentials });
    });

    // ── JOIN MEETING ──────────────────────────────────────────────────────
    // Any participant (including host) joins a room.
    socket.on('join_meeting', (data, ack) => {
      const { meetingId, password, shareToken, name } = data;

      // Find the room
      let room = rooms.get(meetingId);
      if (!room && shareToken) {
        // Find by share token (passwordless join via share link)
        room = [...rooms.values()].find(r => r.shareToken === shareToken);
      }

      if (!room) return ack({ ok: false, error: 'Meeting not found' });

      // Password check (skip for share-token joins)
      if (password && password !== room.password) {
        return ack({ ok: false, error: 'Incorrect password' });
      }

      // Join the socket.io room (each meeting is a room)
      socket.join(room.meetingId);
      currentRoom = room;
      currentMeetingId = room.meetingId;

      // Create participant record
      const participant = createParticipant(socket.id, { name, ...data });
      room.participants[socket.id] = participant;

      // Tell existing participants about the new arrival
      socket.to(room.meetingId).emit('participant_joined', {
        socketId: socket.id,
        name: participant.name,
        participantId: socket.id,
      });

      // Inject into the observation pipeline
      if (room.session) {
        injectIntoSession(room.session, 'participant_joined', {
          participantId: socket.id,
          name: participant.name,
        }, room);
      }

      // Tell the new participant who else is here
      const others = Object.entries(room.participants)
        .filter(([id]) => id !== socket.id)
        .map(([id, p]) => ({ socketId: id, name: p.name }));

      ack({
        ok: true,
        meetingId: room.meetingId,
        iceServers: ICE_SERVERS,
        participants: others,
        settings: room.settings,
        chatHistory: room.chatMessages.slice(-50),
        isHost: socket.id === room.hostId,
      });

      console.log(`[realtime] ${name} joined ${room.meetingId} (${Object.keys(room.participants).length} total)`);
    });

    // ── WebRTC SIGNALING ──────────────────────────────────────────────────
    // These events are the core of WebRTC — browsers exchange offers, answers,
    // and ICE candidates to establish peer-to-peer connections.
    // This pattern is identical to your canvas repo's WebRTC implementation.

    // Forward WebRTC offer to the target peer
    socket.on('webrtc_offer', ({ to, offer }) => {
      socket.to(to).emit('webrtc_offer', { from: socket.id, offer });
    });

    // Forward WebRTC answer
    socket.on('webrtc_answer', ({ to, answer }) => {
      socket.to(to).emit('webrtc_answer', { from: socket.id, answer });
    });

    // Forward ICE candidates
    socket.on('webrtc_ice_candidate', ({ to, candidate }) => {
      socket.to(to).emit('webrtc_ice_candidate', { from: socket.id, candidate });
    });

    // ── MEDIA STATE CHANGES ───────────────────────────────────────────────
    socket.on('media_state', (data) => {
      if (!currentRoom) return;
      const p = currentRoom.participants[socket.id];
      if (p) {
        p.camera = data.camera;
        p.mic = data.mic;
      }
      socket.to(currentMeetingId).emit('participant_media_state', {
        socketId: socket.id,
        camera: data.camera,
        mic: data.mic,
      });
    });

    // ── ENGAGEMENT EVENTS ─────────────────────────────────────────────────
    // These map to observation signals in the dataset.

    // Speaking detection (VAD - Voice Activity Detection from the browser)
    socket.on('speaking', ({ speaking }) => {
      if (!currentRoom) return;
      const p = currentRoom.participants[socket.id];
      if (!p) return;

      if (speaking) {
        p._speakStart = Date.now();
      } else if (p._speakStart) {
        p.speakingSeconds += (Date.now() - p._speakStart) / 1000;
        delete p._speakStart;
      }

      // Broadcast to room so other participants see who is speaking
      socket.to(currentMeetingId).emit('participant_speaking', {
        socketId: socket.id,
        speaking,
      });

      // Inject engagement signal into observation pipeline
      if (speaking && currentRoom.session) {
        injectIntoSession(currentRoom.session, 'participant_speaking', {
          participantId: socket.id,
          name: p.name,
        }, currentRoom);
      }
    });

    // Emoji reactions
    socket.on('react', (data) => {
      if (!currentRoom) return;
      const p = currentRoom.participants[socket.id];
      if (p) p.reactionCount++;

      socket.to(currentMeetingId).emit('participant_reacted', {
        socketId: socket.id,
        name: p?.name,
        emoji: data.emoji,
      });

      if (currentRoom.session) {
        injectIntoSession(currentRoom.session, 'participant_reacted', {
          participantId: socket.id,
          name: p?.name,
          payload: { emoji: data.emoji },
        }, currentRoom);
      }
    });

    // Raise hand
    socket.on('raise_hand', () => {
      if (!currentRoom) return;
      const p = currentRoom.participants[socket.id];
      if (p) p.handRaisedCount++;
      socket.to(currentMeetingId).emit('hand_raised', { socketId: socket.id, name: p?.name });

      if (currentRoom.session) {
        injectIntoSession(currentRoom.session, 'hand_raised', {
          participantId: socket.id,
          name: p?.name,
        }, currentRoom);
      }
    });

    // ── CHAT ─────────────────────────────────────────────────────────────
    socket.on('chat_message', (data) => {
      if (!currentRoom) return;
      if (!currentRoom.settings.chatEnabled) return;

      const p = currentRoom.participants[socket.id];
      if (p) p.chatCount++;

      const msg = {
        id: `msg_${Date.now()}_${socket.id.slice(0, 6)}`,
        socketId: socket.id,
        name: p?.name || 'Unknown',
        text: data.text,
        ts: new Date().toISOString(),
      };

      currentRoom.chatMessages.push(msg);
      if (currentRoom.chatMessages.length > 200) currentRoom.chatMessages.shift();

      // Broadcast to everyone in the room (including sender for confirmation)
      meetingNS.to(currentMeetingId).emit('chat_message', msg);

      if (currentRoom.session) {
        injectIntoSession(currentRoom.session, 'chat_message', {
          participantId: socket.id,
          name: p?.name,
          payload: { text: data.text },
        }, currentRoom);
      }
    });

    // ── AI CHAT for meeting participants ──────────────────────────────────
    // Any participant can ask the AI assistant a question during the meeting.
    // Streams back token by token, just like your canvas repo's AI bot.
    socket.on('ai_chat', async (data) => {
      const { history, question } = data;
      if (!currentRoom) return;

      const sessionContext = currentRoom.session ? {
        surface: currentRoom.session.surfaceId,
        stage: currentRoom.session.stageId,
        retention: currentRoom.session.peak > 0
          ? Object.keys(currentRoom.participants).filter(id => currentRoom.participants[id].active).length / currentRoom.session.peak
          : 1,
        focus: computeRoomFocus(currentRoom),
        rows: currentRoom.session.dataset.length,
        levers: currentRoom.session.levers.map(l => l.label),
      } : null;

      const messages = await buildChatMessages(
        [...(history || []), { role: 'user', content: question }],
        sessionContext
      );

      socket.emit('ai_chat_start');
      await streamChat(messages, (token) => {
        if (token === null) {
          socket.emit('ai_chat_done');
        } else {
          socket.emit('ai_chat_token', { token });
        }
      });
    });

    // ── HOST CONTROLS ─────────────────────────────────────────────────────
    socket.on('host_action', async (data) => {
      if (!currentRoom || socket.id !== currentRoom.hostId) return;

      switch (data.action) {
        case 'mute_all':
          meetingNS.to(currentMeetingId).emit('muted_by_host');
          break;
        case 'disable_video':
          meetingNS.to(currentMeetingId).emit('video_disabled_by_host');
          break;
        case 'toggle_chat':
          currentRoom.settings.chatEnabled = !currentRoom.settings.chatEnabled;
          meetingNS.to(currentMeetingId).emit('chat_toggled', { enabled: currentRoom.settings.chatEnabled });
          break;
        case 'nudge_ai': {
          // Host requests an AI nudge based on current room state
          const nudgeData = {
            surface: currentRoom.surface,
            stage: currentRoom.session?.stageId ?? 'main',
            stageLabel: currentRoom.session?.stageId ?? 'Main Session',
            focus: computeRoomFocus(currentRoom),
            retention: computeRoomRetention(currentRoom),
            concurrent: Object.values(currentRoom.participants).filter(p => p.active).length,
            peak: currentRoom.session?.peak ?? Object.keys(currentRoom.participants).length,
            dropCount: 0,
            topReason: 'manual operator request',
            availableLevers: currentRoom.session?.levers.map(l => l.label) ?? [],
            triggerType: 'custom',
          };

          const nudge = await generateNudge(nudgeData);
          // Emit to host only
          socket.emit('ai_nudge', nudge);
          // Also inject into session dataset
          if (currentRoom.session) {
            currentRoom.session.nudges.push({
              id: `nud_real_${Date.now()}`,
              t: currentRoom.session.t,
              urgency: 'medium',
              text: nudge.text,
              stage: currentRoom.session.stageId,
              source: nudge.source,
              acted: false,
            });
          }
          break;
        }
      }
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      if (!currentRoom) return;

      const p = currentRoom.participants[socket.id];
      if (p) {
        p.active = false;
        p.leftAt = Date.now();
        // End speaking timer if still running
        if (p._speakStart) {
          p.speakingSeconds += (Date.now() - p._speakStart) / 1000;
          delete p._speakStart;
        }
      }

      // Notify remaining participants
      socket.to(currentMeetingId).emit('participant_left', {
        socketId: socket.id,
        name: p?.name,
      });

      // Inject leave event into observation pipeline
      if (currentRoom.session) {
        injectIntoSession(currentRoom.session, 'participant_left', {
          participantId: socket.id,
          name: p?.name,
        }, currentRoom);
      }

      const activeCount = Object.values(currentRoom.participants).filter(x => x.active).length;
      console.log(`[realtime] ${p?.name ?? socket.id} left ${currentMeetingId} (${activeCount} remaining)`);

      // Detect departure burst and trigger AI nudge
      if (currentRoom.burstDetector.record(1) && currentRoom.session) {
        const nudgeContext = {
          surface: currentRoom.surface,
          stage: currentRoom.session.stageId,
          stageLabel: currentRoom.session.stageId,
          focus: computeRoomFocus(currentRoom),
          retention: computeRoomRetention(currentRoom),
          concurrent: activeCount,
          peak: currentRoom.session.peak,
          dropCount: currentRoom.burstDetector.threshold,
          topReason: 'multiple participants left simultaneously',
          availableLevers: currentRoom.session.levers.map(l => l.label),
          triggerType: 'burst',
        };

        // Generate AI nudge asynchronously — don't block disconnect handler
        generateNudge(nudgeContext).then(nudge => {
          // Send nudge to host
          if (currentRoom.hostId) {
            meetingNS.to(currentRoom.hostId).emit('ai_nudge', nudge);
          }
          // Also add to session nudges
          if (currentRoom.session) {
            currentRoom.session.nudges.push({
              id: `nud_burst_${Date.now()}`,
              t: currentRoom.session.t,
              urgency: 'high',
              text: nudge.text,
              stage: currentRoom.session.stageId,
              source: nudge.source,
              acted: false,
            });
          }
        }).catch(console.error);
      }

      // Clean up empty rooms
      if (activeCount === 0) {
        setTimeout(() => {
          if (rooms.has(currentMeetingId)) {
            const r = rooms.get(currentMeetingId);
            if (Object.values(r.participants).filter(p => p.active).length === 0) {
              rooms.delete(currentMeetingId);
              console.log(`[realtime] room ${currentMeetingId} cleaned up`);
            }
          }
        }, 5 * 60 * 1000); // 5 minute grace period
      }
    });
  });

  console.log('[realtime] Socket.io meeting server attached');
  return { io, rooms };
}

// ── Room focus computation ────────────────────────────────────────────────
function computeRoomFocus(room) {
  const active = Object.values(room.participants).filter(p => p.active);
  if (!active.length) return 0;

  // Simple focus heuristic based on engagement activity
  const now = Date.now();
  const focusScores = active.map(p => {
    const durationMin = Math.max(1, (now - p.joinedAt) / 60000);
    const rate = Math.min(1,
      (p.speakingSeconds / 60 + p.reactionCount * 2 + p.chatCount * 1.5) / (durationMin * 3)
    );
    return Math.max(0.15, Math.min(1, 0.4 + rate * 0.6));
  });

  return parseFloat((focusScores.reduce((a, b) => a + b, 0) / focusScores.length).toFixed(4));
}

// ── Room retention computation ────────────────────────────────────────────
function computeRoomRetention(room) {
  const peak = Object.keys(room.participants).length;
  const active = Object.values(room.participants).filter(p => p.active).length;
  return peak > 0 ? parseFloat((active / peak).toFixed(4)) : 1;
}

// ── Get room state (for REST API endpoint) ────────────────────────────────
export function getRooms() {
  return [...rooms.entries()].map(([id, r]) => ({
    meetingId: id,
    surface: r.surface,
    participantCount: Object.values(r.participants).filter(p => p.active).length,
    createdAt: r.createdAt,
    hasSession: Boolean(r.session),
  }));
}

/**
 * web/meeting.js — Real WebRTC Meeting Room Logic
 *
 * This is the browser-side code for the real video meeting room.
 * Pattern adapted from your Real-Time-Collaborative-Digital-Canvas repo.
 *
 * What happens:
 *  1. User allows camera/mic → gets local stream
 *  2. User enters meeting ID + password → joins Socket.io room
 *  3. For each existing participant, we create a WebRTC peer connection
 *     and exchange SDP offer/answer + ICE candidates via Socket.io signaling
 *  4. Real video tracks flow peer-to-peer between browsers
 *  5. Every event (join, leave, speak, react, chat) goes to the server
 *     which injects it into the Backstage observation pipeline
 *
 * No simulations. All real.
 */

/* ── State ─────────────────────────────────────────────────────────────── */
const state = {
  localStream: null,     // MediaStream from getUserMedia
  screenStream: null,    // MediaStream from getDisplayMedia (screen share)
  peers: new Map(),      // socketId → RTCPeerConnection
  socket: null,          // Socket.io connection to /meeting namespace
  meetingId: null,
  myName: null,
  iceServers: [],
  camOn: true,
  micOn: true,
  screenOn: false,
  speakingDetector: null,
  aiHistory: [],         // AI chat message history
};

/* ── DOM refs ────────────────────────────────────────────────────────────*/
const $ = id => document.getElementById(id);
const joinScreen  = $('joinScreen');
const topbar      = $('topbar');
const mainArea    = $('mainArea');
const videoGrid   = $('videoGrid');
const localVideo  = $('localVideo');
const previewVideo = $('previewVideo');
const joinError   = $('joinError');
const nudgeOverlay = $('nudgeOverlay');
const chatPanel   = $('panel-chat');
const aiPanel     = $('panel-ai');
const participantsPanel = $('panel-participants');
let meetingStartTime;

/* ── Init: camera preview on join screen ────────────────────────────────*/
async function initPreview() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    state.localStream = stream;
    previewVideo.srcObject = stream;
  } catch (e) {
    console.warn('[meeting] preview failed:', e.message);
    // No camera — that's fine, audio-only mode
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      state.localStream = stream;
    } catch {
      // No media at all — proceed in observer mode
    }
  }
}

/* ── Camera/Mic toggles on join screen ──────────────────────────────────*/
$('togglePreviewCam').addEventListener('click', () => {
  if (!state.localStream) return;
  const track = state.localStream.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    state.camOn = track.enabled;
    $('togglePreviewCam').style.opacity = track.enabled ? '1' : '0.4';
    previewVideo.style.display = track.enabled ? 'block' : 'none';
  }
});

$('togglePreviewMic').addEventListener('click', () => {
  if (!state.localStream) return;
  const track = state.localStream.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    state.micOn = track.enabled;
    $('togglePreviewMic').style.opacity = track.enabled ? '1' : '0.4';
  }
});

/* ── Join meeting ────────────────────────────────────────────────────────*/
$('btnJoin').addEventListener('click', joinMeeting);
$('joinPassword').addEventListener('keydown', e => { if (e.key === 'Enter') joinMeeting(); });

async function joinMeeting() {
  const name = $('joinName').value.trim();
  const meetingId = $('joinMeetingId').value.trim();
  const password = $('joinPassword').value;

  if (!name) { joinError.textContent = 'Please enter your name'; return; }
  if (!meetingId) { joinError.textContent = 'Please enter the Meeting ID'; return; }

  joinError.textContent = '';
  $('btnJoin').textContent = 'Joining...';
  $('btnJoin').disabled = true;

  try {
    await connectToMeeting(name, meetingId, password);
  } catch (e) {
    joinError.textContent = e.message || 'Failed to join meeting';
    $('btnJoin').textContent = 'Join Meeting';
    $('btnJoin').disabled = false;
  }
}

/* ── Socket.io + WebRTC setup ────────────────────────────────────────────*/
async function connectToMeeting(name, meetingId, password) {
  // Connect to the /meeting Socket.io namespace
  const socket = io('/meeting', { transports: ['websocket', 'polling'] });
  state.socket = socket;
  state.myName = name;
  state.meetingId = meetingId;

  // Wait for connection
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });

  // Join the meeting room
  const result = await new Promise((resolve) => {
    socket.emit('join_meeting', { name, meetingId, password }, resolve);
  });

  if (!result.ok) throw new Error(result.error || 'Join failed');

  // We're in! Set up state
  state.iceServers = result.iceServers;

  // Set up local video
  $('localName').textContent = name + ' (You)';
  $('localAvatar').textContent = name[0].toUpperCase();
  localVideo.srcObject = state.localStream;
  if (state.localStream?.getVideoTracks()[0]?.enabled) {
    $('localNoVideo').style.display = 'none';
  }

  // Show main UI
  joinScreen.style.display = 'none';
  topbar.style.display = 'flex';
  mainArea.style.display = 'grid';
  $('meetingIdDisplay').textContent = meetingId;
  meetingStartTime = Date.now();
  startTimer();

  // Restore chat history
  for (const msg of result.chatHistory || []) {
    appendChatMessage(msg);
  }

  // Create peer connections with everyone already in the room
  for (const other of result.participants) {
    createPeerConnection(other.socketId, other.name, true /* we are the caller */);
  }

  // ── Socket.io event handlers ──────────────────────────────────────────

  // New participant joined — we receive their ID, they'll call us
  socket.on('participant_joined', ({ socketId, name: pName }) => {
    // The new participant will initiate the offer; we just add a tile
    addVideoTile(socketId, pName);
    updateParticipantCount();
  });

  // Incoming WebRTC offer (someone is calling us)
  socket.on('webrtc_offer', async ({ from, offer }) => {
    if (!state.peers.has(from)) {
      createPeerConnection(from, '...', false /* they called us */);
    }
    const pc = state.peers.get(from);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { to: from, answer });
  });

  // Incoming WebRTC answer
  socket.on('webrtc_answer', async ({ from, answer }) => {
    const pc = state.peers.get(from);
    if (pc) await pc.setRemoteDescription(answer);
  });

  // Incoming ICE candidate
  socket.on('webrtc_ice_candidate', async ({ from, candidate }) => {
    const pc = state.peers.get(from);
    if (pc && candidate) {
      try { await pc.addIceCandidate(candidate); } catch {}
    }
  });

  // Media state change (cam/mic toggle from another participant)
  socket.on('participant_media_state', ({ socketId, camera, mic }) => {
    const tile = document.getElementById('tile-' + socketId);
    if (tile) {
      tile.querySelector('[data-cam]').textContent = camera ? '📷' : '📷';
      tile.querySelector('[data-cam]').classList.toggle('off', !camera);
      tile.querySelector('[data-mic]').classList.toggle('off', !mic);
    }
  });

  // Speaking indicator
  socket.on('participant_speaking', ({ socketId, speaking }) => {
    const tile = document.getElementById('tile-' + socketId);
    if (tile) tile.classList.toggle('speaking', speaking);
  });

  // Reaction
  socket.on('participant_reacted', ({ socketId, name: rName, emoji }) => {
    showFloatingEmoji(emoji, socketId);
  });

  // Hand raised
  socket.on('hand_raised', ({ socketId, name: hName }) => {
    showToast(`✋ ${hName || 'Someone'} raised their hand`);
  });

  // Chat message
  socket.on('chat_message', appendChatMessage);

  // AI streaming tokens
  socket.on('ai_chat_start', () => appendAiThinking());
  socket.on('ai_chat_token', ({ token }) => appendAiToken(token));
  socket.on('ai_chat_done', () => finalizeAiMessage());

  // AI nudge from server (triggered on burst detection)
  socket.on('ai_nudge', (nudge) => showNudge(nudge));

  // Participant left
  socket.on('participant_left', ({ socketId, name: lName }) => {
    removeVideoTile(socketId);
    const pc = state.peers.get(socketId);
    if (pc) { pc.close(); state.peers.delete(socketId); }
    updateParticipantCount();
    showToast(`${lName || 'A participant'} left`);
  });

  // Host controls
  socket.on('muted_by_host', () => { setMic(false); showToast('Host muted everyone'); });
  socket.on('video_disabled_by_host', () => { setCam(false); showToast('Host disabled video'); });
  socket.on('chat_toggled', ({ enabled }) => {
    showToast(enabled ? 'Chat enabled' : 'Chat disabled by host');
  });

  // Setup speaking detection (Voice Activity Detection)
  setupVAD();
  updateParticipantCount();
}

/* ── Create a WebRTC peer connection ─────────────────────────────────────*/
function createPeerConnection(remoteSocketId, remoteName, isInitiator) {
  const pc = new RTCPeerConnection({ iceServers: state.iceServers });
  state.peers.set(remoteSocketId, pc);

  // Add our local media tracks to the connection
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => {
      pc.addTrack(track, state.localStream);
    });
  }

  // When we get their video/audio, show it in a tile
  pc.ontrack = (event) => {
    const tile = document.getElementById('tile-' + remoteSocketId)
      || addVideoTile(remoteSocketId, remoteName);
    const video = tile.querySelector('video');
    if (video && event.streams[0]) {
      video.srcObject = event.streams[0];
    }
  };

  // Send ICE candidates to the other peer via signaling server
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      state.socket.emit('webrtc_ice_candidate', {
        to: remoteSocketId,
        candidate: event.candidate,
      });
    }
  };

  // Connection state logging
  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] peer ${remoteSocketId} state: ${pc.connectionState}`);
    if (pc.connectionState === 'failed') {
      // Try to restart ICE
      pc.restartIce();
    }
  };

  // If we're the initiator, create and send the offer
  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        state.socket.emit('webrtc_offer', { to: remoteSocketId, offer });
      } catch (e) {
        console.error('[WebRTC] offer failed:', e);
      }
    };
  }

  addVideoTile(remoteSocketId, remoteName);
  return pc;
}

/* ── Add a video tile for a remote participant ───────────────────────────*/
function addVideoTile(socketId, name) {
  if (document.getElementById('tile-' + socketId)) return document.getElementById('tile-' + socketId);

  const hue = name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = 'tile-' + socketId;
  tile.innerHTML = `
    <div class="no-video-bg" id="noVideo-${socketId}">
      <div class="avatar-circle" style="background:hsl(${hue},50%,25%);color:hsl(${hue},70%,60%)">
        ${name[0]?.toUpperCase() || '?'}
      </div>
    </div>
    <video autoplay playsinline></video>
    <div class="name-tag">${escHtml(name)}</div>
    <div class="status-icons">
      <span class="status-icon" data-cam>📷</span>
      <span class="status-icon" data-mic>🎙️</span>
    </div>`;

  // Hide no-video background when video starts playing
  const video = tile.querySelector('video');
  video.addEventListener('loadedmetadata', () => {
    tile.querySelector('.no-video-bg').style.display = 'none';
  });

  videoGrid.appendChild(tile);
  updateParticipantCount();
  return tile;
}

/* ── Remove a video tile ─────────────────────────────────────────────────*/
function removeVideoTile(socketId) {
  document.getElementById('tile-' + socketId)?.remove();
  updateParticipantCount();
}

/* ── Control buttons ─────────────────────────────────────────────────────*/
$('btnCam').addEventListener('click', () => setCam(!state.camOn));
$('btnMic').addEventListener('click', () => setMic(!state.micOn));
$('btnLeave').addEventListener('click', leaveMeeting);
$('btnLeave2').addEventListener('click', leaveMeeting);

function setCam(on) {
  state.camOn = on;
  if (state.localStream) {
    state.localStream.getVideoTracks().forEach(t => { t.enabled = on; });
  }
  $('btnCam').style.opacity = on ? '1' : '0.4';
  $('localCamIcon').classList.toggle('off', !on);
  $('localNoVideo').style.display = on ? 'none' : 'flex';
  state.socket?.emit('media_state', { camera: on, mic: state.micOn });
}

function setMic(on) {
  state.micOn = on;
  if (state.localStream) {
    state.localStream.getAudioTracks().forEach(t => { t.enabled = on; });
  }
  $('btnMic').style.opacity = on ? '1' : '0.4';
  $('localMicIcon').classList.toggle('off', !on);
  state.socket?.emit('media_state', { camera: state.camOn, mic: on });
}

/* ── Screen sharing ──────────────────────────────────────────────────────*/
$('btnScreen').addEventListener('click', async () => {
  if (state.screenOn) {
    // Stop screen share, revert to camera
    if (state.screenStream) {
      state.screenStream.getTracks().forEach(t => t.stop());
      state.screenStream = null;
    }
    state.screenOn = false;
    $('btnScreen').style.opacity = '1';
    // Replace screen track with camera track for all peers
    replaceVideoTrack(state.localStream?.getVideoTracks()[0]);
    return;
  }

  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    state.screenStream = screen;
    state.screenOn = true;
    $('btnScreen').style.opacity = '0.5';

    // Replace camera track with screen track for all peers
    const screenTrack = screen.getVideoTracks()[0];
    replaceVideoTrack(screenTrack);

    // Auto-stop when user clicks browser's "Stop sharing" button
    screenTrack.onended = () => {
      state.screenOn = false;
      $('btnScreen').style.opacity = '1';
      replaceVideoTrack(state.localStream?.getVideoTracks()[0]);
    };
  } catch (e) {
    console.warn('[meeting] screen share cancelled or denied');
  }
});

function replaceVideoTrack(newTrack) {
  if (!newTrack) return;
  // Show new track in local video
  localVideo.srcObject = new MediaStream([newTrack, ...(state.localStream?.getAudioTracks() || [])]);
  // Replace in all peer connections
  for (const pc of state.peers.values()) {
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) sender.replaceTrack(newTrack).catch(console.error);
  }
}

/* ── Reactions ────────────────────────────────────────────────────────────*/
const EMOJIS = ['👍', '❤️', '😂', '🎉', '🙌', '🔥'];
$('btnReact').addEventListener('click', () => {
  const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  state.socket?.emit('react', { emoji });
  showFloatingEmoji(emoji, 'local');
});

function showFloatingEmoji(emoji, socketId) {
  const tileId = socketId === 'local' ? 'localTile' : 'tile-' + socketId;
  const tile = document.getElementById(tileId) || $('videoGrid');
  const el = document.createElement('span');
  el.textContent = emoji;
  el.style.cssText = `position:absolute;font-size:28px;bottom:40px;left:${20 + Math.random() * 60}%;animation:floatUp 2s ease forwards;pointer-events:none;z-index:10`;
  tile.style.position = 'relative';
  tile.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// Add the float animation
const style = document.createElement('style');
style.textContent = '@keyframes floatUp { 0% { opacity:1; transform:translateY(0); } 100% { opacity:0; transform:translateY(-80px); } }';
document.head.appendChild(style);

/* ── Raise hand ──────────────────────────────────────────────────────────*/
$('btnHand').addEventListener('click', () => {
  state.socket?.emit('raise_hand');
  $('btnHand').style.opacity = '0.4';
  setTimeout(() => $('btnHand').style.opacity = '1', 3000);
});

/* ── Chat ─────────────────────────────────────────────────────────────────*/
$('btnSend').addEventListener('click', sendChat);
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
$('btnChat').addEventListener('click', () => switchSidebarTab('chat'));

function sendChat() {
  const text = $('chatInput').value.trim();
  if (!text || !state.socket) return;
  state.socket.emit('chat_message', { text });
  $('chatInput').value = '';
}

function appendChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<div class="sender">${escHtml(msg.name)}</div><div class="text">${escHtml(msg.text)}</div>`;
  chatPanel.appendChild(div);
  chatPanel.scrollTop = chatPanel.scrollHeight;
}

/* ── AI Assistant ─────────────────────────────────────────────────────────*/
$('btnAI').addEventListener('click', () => switchSidebarTab('ai'));
$('btnAiSend').addEventListener('click', sendAiMessage);
$('aiInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendAiMessage(); });

function sendAiMessage() {
  const question = $('aiInput').value.trim();
  if (!question || !state.socket) return;
  $('aiInput').value = '';

  // Show user question
  const userDiv = document.createElement('div');
  userDiv.className = 'ai-msg';
  userDiv.innerHTML = `<div class="user-msg">You: ${escHtml(question)}</div><div class="ai-label">AI ASSISTANT</div><span id="aiStream"></span>`;
  aiPanel.appendChild(userDiv);
  aiPanel.scrollTop = aiPanel.scrollHeight;

  state.aiHistory.push({ role: 'user', content: question });
  state.socket.emit('ai_chat', { history: state.aiHistory, question });
}

let aiStreamEl = null;
let aiStreamText = '';

function appendAiThinking() {
  aiStreamEl = aiPanel.querySelector('#aiStream');
  if (aiStreamEl) {
    aiStreamEl.innerHTML = '<span class="ai-thinking">🤖 Thinking<span class="ai-cursor"></span></span>';
  }
  aiStreamText = '';
}

function appendAiToken(token) {
  if (!aiStreamEl) return;
  aiStreamText += token;
  aiStreamEl.textContent = aiStreamText;
  aiPanel.scrollTop = aiPanel.scrollHeight;
}

function finalizeAiMessage() {
  state.aiHistory.push({ role: 'assistant', content: aiStreamText });
  if (aiPanel.querySelector('#aiStream')) {
    aiPanel.querySelector('#aiStream').id = ''; // deactivate stream target
  }
  aiStreamEl = null;
}

/* ── AI Nudge (host button + server push) ────────────────────────────────*/
$('btnAiNudge').addEventListener('click', () => {
  state.socket?.emit('host_action', { action: 'nudge_ai' });
});

function showNudge(nudge) {
  nudgeOverlay.classList.remove('high', 'medium', 'low');
  nudgeOverlay.classList.add(nudge.urgency || 'medium');
  $('nudgeHeader').textContent = `🤖 AI NUDGE${nudge.urgency === 'high' ? ' — ACTION NEEDED' : ''}`;
  $('nudgeText').textContent = nudge.text;
  $('nudgeSource').textContent = nudge.source === 'llm'
    ? `Generated by ${nudge.model || 'AI'}`
    : 'Rule-based suggestion';
  nudgeOverlay.classList.add('show');
  // Auto-dismiss after 12 seconds
  setTimeout(() => nudgeOverlay.classList.remove('show'), 12000);
}
$('nudgeClose').addEventListener('click', () => nudgeOverlay.classList.remove('show'));

/* ── Voice Activity Detection (VAD) ─────────────────────────────────────*/
// Tells the server (and others) when we're speaking — this is how the AI
// knows engagement signals. Uses the Web Audio API to measure audio level.
function setupVAD() {
  if (!state.localStream?.getAudioTracks()[0]) return;
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(state.localStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let speaking = false;
  const THRESHOLD = 18;

  setInterval(() => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const nowSpeaking = avg > THRESHOLD && state.micOn;

    if (nowSpeaking !== speaking) {
      speaking = nowSpeaking;
      state.socket?.emit('speaking', { speaking });
      // Local visual indicator
      $('localTile').classList.toggle('speaking', speaking);
    }
  }, 100);
}

/* ── Sidebar tabs ────────────────────────────────────────────────────────*/
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => switchSidebarTab(tab.dataset.panel));
});

function switchSidebarTab(panel) {
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('on', t.dataset.panel === panel));
  document.querySelectorAll('.sidebar-content').forEach(c => c.classList.toggle('on', c.id === 'panel-' + panel));
  $('chatInputRow').style.display = panel === 'chat' ? 'flex' : 'none';
  $('aiInputRow').style.display = panel === 'ai' ? 'flex' : 'none';
}

/* ── Participant count ────────────────────────────────────────────────────*/
function updateParticipantCount() {
  const count = 1 + state.peers.size; // +1 for self
  $('participantCount').textContent = count;

  // Update participants panel
  participantsPanel.innerHTML = '';
  const self = document.createElement('div');
  self.className = 'participant-item';
  const selfHue = (state.myName || '?').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  self.innerHTML = `<div class="participant-avatar" style="background:hsl(${selfHue},50%,25%);color:hsl(${selfHue},70%,60%)">${(state.myName || '?')[0].toUpperCase()}</div><span class="participant-name">${escHtml(state.myName || 'You')} (You)</span><span class="participant-icons">📷 🎙️</span>`;
  participantsPanel.appendChild(self);

  state.peers.forEach((pc, socketId) => {
    const tile = document.getElementById('tile-' + socketId);
    const name = tile?.querySelector('.name-tag')?.textContent || 'Participant';
    const hue = name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
    const item = document.createElement('div');
    item.className = 'participant-item';
    item.innerHTML = `<div class="participant-avatar" style="background:hsl(${hue},50%,25%);color:hsl(${hue},70%,60%)">${name[0]?.toUpperCase()}</div><span class="participant-name">${escHtml(name)}</span>`;
    participantsPanel.appendChild(item);
  });
}

/* ── Meeting timer ───────────────────────────────────────────────────────*/
function startTimer() {
  setInterval(() => {
    if (!meetingStartTime) return;
    const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    $('meetingTimer').textContent = `${m}:${s}`;
  }, 1000);
}

/* ── Leave meeting ───────────────────────────────────────────────────────*/
function leaveMeeting() {
  state.socket?.disconnect();
  state.localStream?.getTracks().forEach(t => t.stop());
  state.screenStream?.getTracks().forEach(t => t.stop());
  state.peers.forEach(pc => pc.close());
  state.peers.clear();
  window.location.href = '/';
}

/* ── Toast notification ──────────────────────────────────────────────────*/
function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e2330;border:1px solid #2a3040;border-radius:8px;padding:8px 16px;font-size:13px;z-index:500;animation:fadeIn 0.2s ease';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* ── Utilities ───────────────────────────────────────────────────────────*/
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ── Auto-init ────────────────────────────────────────────────────────────*/
// Check for meeting ID in URL (from share link)
const urlParams = new URLSearchParams(location.search);
if (urlParams.has('meetingId')) $('joinMeetingId').value = urlParams.get('meetingId');
if (urlParams.has('name')) $('joinName').value = urlParams.get('name');

// Start camera preview
initPreview();

/**
 * web/ai-widget.js — Floating AI Assistant Widget
 *
 * This is the operator-side AI chat panel that floats over every tab in the
 * Backstage console. It connects to the real /api/chat SSE streaming endpoint
 * (which calls real Groq LLaMA 3.3 70B) so every response is real AI, not
 * a hard-coded string.
 *
 * Also handles:
 *   - Meeting tab: Create/join meeting buttons, AI status display, active rooms
 *   - LLM status check on load (shows whether real AI is configured)
 */

const $ = id => document.getElementById(id);

/* ── AI Chat Widget ─────────────────────────────────────────────────────── */
const aiWidgetBtn  = $('aiWidgetBtn');
const aiWidgetPanel = $('aiWidgetPanel');
const aiWidgetMessages = $('aiWidgetMessages');
const aiWidgetInput = $('aiWidgetInput');
const aiWidgetStatus = $('aiWidgetStatus');

let aiHistory = [];  // {role, content}[] kept in memory for context

// Toggle open/close
aiWidgetBtn.addEventListener('click', () => {
  const open = aiWidgetPanel.style.display === 'none' || aiWidgetPanel.style.display === '';
  aiWidgetPanel.style.display = open ? 'block' : 'none';
  aiWidgetBtn.style.transform = open ? 'rotate(10deg) scale(1.1)' : '';
});
$('aiWidgetClose').addEventListener('click', () => {
  aiWidgetPanel.style.display = 'none';
  aiWidgetBtn.style.transform = '';
});

// Send message on button click or Enter key
$('aiWidgetSend').addEventListener('click', sendWidgetMessage);
aiWidgetInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendWidgetMessage(); }
});

async function sendWidgetMessage() {
  const question = aiWidgetInput.value.trim();
  if (!question) return;
  aiWidgetInput.value = '';

  // Add user message bubble
  appendWidgetMsg('user', question);
  aiHistory.push({ role: 'user', content: question });

  // Get session context from the main app's state (if available)
  const sessionContext = getSessionContext();

  // Create AI message bubble with streaming cursor
  const aiDiv = document.createElement('div');
  aiDiv.style.cssText = 'background:#1e2330;border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.6;border:1px solid #2a3040';
  aiDiv.innerHTML = '<span style="font-size:10px;font-weight:700;color:#4f8ef7;letter-spacing:0.5px;display:block;margin-bottom:4px">AI ASSISTANT</span><span id="aiStreamCurrent">⋯</span>';
  aiWidgetMessages.appendChild(aiDiv);
  aiWidgetMessages.scrollTop = aiWidgetMessages.scrollHeight;

  const streamSpan = aiDiv.querySelector('#aiStreamCurrent');
  let streamText = '';

  try {
    // Call the real /api/chat SSE endpoint
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: aiHistory.slice(-10),  // keep context window manageable
        sessionContext,
      }),
    });

    if (!resp.ok) throw new Error('API error ' + resp.status);

    // Stream tokens from the SSE response
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const { token } = JSON.parse(data);
          if (token) {
            streamText += token;
            streamSpan.textContent = streamText;
            aiWidgetMessages.scrollTop = aiWidgetMessages.scrollHeight;
          }
        } catch {}
      }
    }

    // Save to history
    aiHistory.push({ role: 'assistant', content: streamText });
    streamSpan.id = ''; // deactivate stream target
  } catch (e) {
    streamSpan.textContent = 'Error: ' + e.message;
    streamSpan.style.color = '#f87171';
  }
}

function appendWidgetMsg(role, text) {
  const div = document.createElement('div');
  div.style.cssText = role === 'user'
    ? 'background:#0d1626;border-radius:8px;padding:8px 12px;font-size:13px;color:#94a3b8;border:1px solid #1e2d45;text-align:right'
    : 'background:#1e2330;border-radius:8px;padding:8px 12px;font-size:13px;border:1px solid #2a3040';
  div.textContent = text;
  aiWidgetMessages.appendChild(div);
  aiWidgetMessages.scrollTop = aiWidgetMessages.scrollHeight;
}

// Pull current session state from the main app (S is global in app.js)
function getSessionContext() {
  try {
    const S = window.__backstageState;
    if (!S?.ses) return null;
    return {
      surface: S.surfaceId,
      stage: S.ses.stageId,
      focus: S.ses._focusHistory?.slice(-1)[0] ?? null,
      rows: S.ses.dataset.length,
      levers: S.ses.levers.map(l => l.label || l.id),
    };
  } catch { return null; }
}

/* ── LLM Status Check ───────────────────────────────────────────────────── */
async function checkLLMStatus() {
  try {
    const resp = await fetch('/api/llm/status');
    const status = await resp.json();
    const isConfigured = status.configured;

    aiWidgetStatus.textContent = isConfigured
      ? `✓ Real AI (${status.model || status.provider})`
      : '⚠ No API key — add to .env';
    aiWidgetStatus.style.color = isConfigured ? '#34d399' : '#fbbf24';

    // Also update the Meeting tab's AI status pill
    const pill = $('llmStatusPill');
    if (pill) {
      pill.textContent = isConfigured ? `✓ AI: ${status.provider}` : '⚠ No AI key';
      pill.style.borderColor = isConfigured ? '#34d399' : '#fbbf24';
      pill.style.color = isConfigured ? '#34d399' : '#fbbf24';
    }

    const detail = $('aiStatusDetail');
    if (detail) {
      detail.innerHTML = isConfigured
        ? `<div style="color:#34d399;font-weight:600;margin-bottom:6px">✓ Real AI Configured</div>
           <div style="color:#94a3b8">Provider: <strong>${status.provider}</strong></div>
           <div style="color:#94a3b8">Model: <strong>${status.model}</strong></div>
           <div style="color:#64748b;margin-top:8px;font-size:12px">AI nudges are real Groq LLaMA calls. Nudge the operator button generates context-aware suggestions based on actual session state.</div>`
        : `<div style="color:#fbbf24;font-weight:600;margin-bottom:6px">⚠ No API Key Configured</div>
           <div style="color:#94a3b8;font-size:12px">Rule-based nudges are active as fallback.</div>
           <div style="margin-top:10px;padding:10px;background:#0d0f14;border-radius:6px;font-family:monospace;font-size:12px">
             1. Get a free key at <a href="https://console.groq.com" target="_blank" style="color:#4f8ef7">console.groq.com</a><br>
             2. Add to .env: <strong style="color:#34d399">GROQ_API_KEY=gsk_...</strong><br>
             3. Restart: <strong style="color:#34d399">npm run dev</strong>
           </div>`;
    }
  } catch {
    aiWidgetStatus.textContent = 'Server offline';
    aiWidgetStatus.style.color = '#f87171';
  }
}

/* ── Meeting Tab Logic ───────────────────────────────────────────────────── */
const btnCreateMeeting = $('btnCreateMeeting');
const btnRefreshRooms = $('btnRefreshRooms');
const btnJoinConsole = $('btnJoinConsole');

if (btnCreateMeeting) {
  btnCreateMeeting.addEventListener('click', async () => {
    const hostName = $('hostName').value.trim() || 'Host';
    btnCreateMeeting.textContent = 'Creating…';
    btnCreateMeeting.disabled = true;

    try {
      const resp = await fetch('/api/meeting/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostName, surface: 'webinar' }),
      });
      const data = await resp.json();

      if (data.ok) {
        const { meetingId, password, shareUrl } = data.credentials;
        $('credMeetingId').textContent = meetingId;
        $('credPassword').textContent = password;
        $('credShareLink').textContent = window.location.origin + shareUrl;
        $('meetingCredentials').style.display = 'block';

        // Pre-fill join link
        const joinUrl = `/meeting?m=${encodeURIComponent(meetingId)}&p=${encodeURIComponent(password)}&n=${encodeURIComponent(hostName)}`;
        $('btnOpenMeeting').href = joinUrl;
      }
    } catch (e) {
      $('btnCreateMeeting').textContent = 'Error: ' + e.message;
    } finally {
      btnCreateMeeting.textContent = 'Create Meeting Room';
      btnCreateMeeting.disabled = false;
    }
  });
}

if (btnJoinConsole) {
  // Update join link dynamically as user types
  const updateJoinLink = () => {
    const name = $('joinNameConsole').value.trim();
    const id = $('joinIdConsole').value.trim();
    btnJoinConsole.href = `/meeting?m=${encodeURIComponent(id)}&n=${encodeURIComponent(name)}`;
  };
  $('joinNameConsole').addEventListener('input', updateJoinLink);
  $('joinIdConsole').addEventListener('input', updateJoinLink);
}

if (btnRefreshRooms) {
  btnRefreshRooms.addEventListener('click', refreshRooms);
}

async function refreshRooms() {
  const el = $('activeRooms');
  if (!el) return;
  try {
    const resp = await fetch('/api/meeting/list');
    const data = await resp.json();
    if (!data.rooms.length) {
      el.innerHTML = '<span style="color:#64748b">No active rooms — create one above</span>';
      return;
    }
    el.innerHTML = data.rooms.map(r =>
      `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#1a2035;border-radius:8px;margin-bottom:6px">
        <span style="color:#34d399">●</span>
        <div style="flex:1">
          <div style="font-weight:600">${r.meetingId}</div>
          <div style="font-size:11px;color:#64748b">${r.participantCount} participant${r.participantCount !== 1 ? 's' : ''} · ${r.surface}</div>
        </div>
        <a href="/meeting?meetingId=${encodeURIComponent(r.meetingId)}" target="_blank" style="font-size:12px;color:#4f8ef7;text-decoration:none">Join →</a>
      </div>`
    ).join('');
  } catch {
    el.innerHTML = '<span style="color:#f87171">Could not fetch rooms</span>';
  }
}

/* ── Init ────────────────────────────────────────────────────────────────── */
checkLLMStatus();
refreshRooms();

// Refresh rooms every 30 seconds while on meeting tab
setInterval(refreshRooms, 30000);

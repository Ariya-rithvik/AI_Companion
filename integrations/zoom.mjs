/**
 * integrations/zoom.mjs — Zoom & WebRTC Integration
 *
 * Two modes:
 *
 *  Mode A (built-in WebRTC) — DEFAULT, works immediately, no credentials needed.
 *    The built-in meeting room uses Socket.io for signaling + browser WebRTC.
 *    Participants get real camera/mic tiles just like Zoom. See server/realtime.mjs.
 *
 *  Mode B (Zoom Webhooks) — OPTIONAL, requires Zoom developer account.
 *    If you host meetings on Zoom, you can receive webhook events (participant
 *    joined/left, meeting started/ended) and feed them into the observation pipeline.
 *    Set ZOOM_WEBHOOK_SECRET_TOKEN in .env and register this endpoint on zoom.us.
 *
 * For the hackathon, Mode A (built-in WebRTC) is what runs — it uses the exact
 * same WebRTC/Socket.io pattern as your Real-Time-Collaborative-Digital-Canvas repo.
 *
 * To switch to Zoom webhooks, see the handleZoomWebhook() function below.
 */

import crypto from 'node:crypto';

// ── Mode A: Built-in WebRTC Room Config ──────────────────────────────────
/**
 * ICE server configuration for WebRTC peer connections.
 * Google's free STUN servers work for LAN and same-network demos.
 * For production/internet use, add a TURN server.
 *
 * Free TURN options:
 *   - Metered.ca (free tier): https://www.metered.ca/tools/openrelay/
 *   - Twilio (pay-as-you-go): https://www.twilio.com/stun-turn
 */
export const ICE_SERVERS = [
  // Primary STUN — always free, no setup
  { urls: process.env.STUN_SERVER || 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },

  // TURN server (OPTIONAL — uncomment and fill in if you have one)
  // Without TURN, WebRTC works on the same network but may fail across different networks.
  // ...(process.env.TURN_URL ? [{
  //   urls: process.env.TURN_URL,
  //   username: process.env.TURN_USERNAME,
  //   credential: process.env.TURN_CREDENTIAL,
  // }] : []),
];

/**
 * Generate a meeting room ID and password for the built-in meeting room.
 * Format matches your canvas repo's meeting system.
 */
export function createMeetingCredentials(hostName, surface = 'webinar') {
  const meetingId = `BS-${surface.toUpperCase().slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;
  const password = Math.random().toString(36).slice(2, 8).toUpperCase();
  const shareToken = crypto.randomBytes(12).toString('base64url');

  return {
    meetingId,
    password,
    shareToken,
    shareUrl: `/meeting?token=${shareToken}`,
    host: hostName,
    surface,
    createdAt: new Date().toISOString(),
    iceServers: ICE_SERVERS,
  };
}

// ── Mode B: Zoom Webhook Handler ─────────────────────────────────────────
/**
 * Validates and processes Zoom webhook events.
 * Register this handler at POST /integrations/zoom in server/mcp.mjs
 * and set it as your webhook endpoint in the Zoom App Marketplace.
 *
 * Required .env: ZOOM_WEBHOOK_SECRET_TOKEN (from your Zoom App settings)
 *
 * @param {IncomingMessage} req - Node.js HTTP request
 * @param {string} body         - Raw request body (string, for signature validation)
 * @returns {object}            - { valid: bool, event: string, payload: object }
 */
export function handleZoomWebhook(req, body) {
  const secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secretToken) {
    return { valid: false, error: 'ZOOM_WEBHOOK_SECRET_TOKEN not set in .env' };
  }

  // Zoom signature validation
  const timestamp = req.headers['x-zm-request-timestamp'];
  const signature = req.headers['x-zm-signature'];
  if (!timestamp || !signature) {
    return { valid: false, error: 'Missing Zoom signature headers' };
  }

  // Build the message to verify
  const message = `v0:${timestamp}:${body}`;
  const hashForVerify = crypto
    .createHmac('sha256', secretToken)
    .update(message)
    .digest('hex');
  const expectedSig = `v0=${hashForVerify}`;

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return { valid: false, error: 'Zoom signature mismatch — invalid webhook' };
  }

  // Parse the event
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return { valid: false, error: 'Invalid JSON in webhook body' };
  }

  // Zoom sends a URL validation challenge on first registration
  if (payload.event === 'endpoint.url_validation') {
    const hashForValidate = crypto
      .createHmac('sha256', secretToken)
      .update(payload.payload.plainToken)
      .digest('hex');
    return {
      valid: true,
      event: 'endpoint.url_validation',
      response: { plainToken: payload.payload.plainToken, encryptedToken: hashForValidate },
    };
  }

  // Map Zoom events to our observation event names
  const eventMap = {
    'meeting.participant_joined': 'participant_joined',
    'meeting.participant_left':   'participant_left',
    'meeting.started':            'session_start',
    'meeting.ended':              'session_end',
    'webinar.participant_joined': 'participant_joined',
    'webinar.participant_left':   'participant_left',
  };

  const mappedEvent = eventMap[payload.event];
  if (!mappedEvent) {
    return { valid: true, event: payload.event, mapped: null, payload: payload.payload };
  }

  // Extract participant data for our observation pipeline
  const participant = payload.payload?.object?.participant;
  const meeting = payload.payload?.object;

  return {
    valid: true,
    event: mappedEvent,
    zoomEvent: payload.event,
    meetingId: meeting?.id,
    payload: {
      participantId: participant?.id || participant?.user_id,
      name: participant?.user_name || participant?.display_name,
      email: participant?.email,
      joinTime: participant?.join_time,
      leaveTime: participant?.leave_time,
    },
  };
}

// ── WebRTC utility: describes what browser getUserMedia constraints to use ─
/**
 * Returns recommended getUserMedia constraints for different surface types.
 * A webinar needs full 720p video; a support queue just needs audio.
 */
export function getMediaConstraints(surface = 'webinar') {
  switch (surface) {
    case 'webinar':
      return {
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
      };
    case 'support':
    case 'codereview':
      // For text-heavy surfaces, audio is enough; video is optional
      return {
        video: false,  // user can enable if needed
        audio: { echoCancellation: true, noiseSuppression: true },
      };
    default:
      return {
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      };
  }
}

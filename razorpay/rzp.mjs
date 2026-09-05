/**
 * razorpay/rzp.mjs — Razorpay test-mode wrapper.
 *
 * Zero dependencies, Node 20, ESM.
 *
 * Auth: HTTP Basic from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
 * Throws RazorpayConfigError at import time if either is missing.
 * NEVER logs a secret.
 *
 * Every function that takes `amount` expects **paise** (1 INR = 100 paise).
 * The caller sends paise; the API receives paise. No conversion happens here.
 *
 * Retry policy: 5xx → exponential backoff, max 3 attempts. 4xx → never retry.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

// ── Config ────────────────────────────────────────────────────────────────

class RazorpayConfigError extends Error {
  constructor(msg) { super(msg); this.name = 'RazorpayConfigError'; }
}

const KEY_ID     = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID)     throw new RazorpayConfigError('RAZORPAY_KEY_ID is not set in the environment.');
if (!KEY_SECRET) throw new RazorpayConfigError('RAZORPAY_KEY_SECRET is not set in the environment.');

const AUTH = 'Basic ' + Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64');

// ── Internal HTTP helper ──────────────────────────────────────────────────

/**
 * Make an authenticated request to the Razorpay API.
 * Retries on 5xx with exponential backoff (100ms, 200ms, 400ms). Never retries 4xx.
 *
 * @param {'GET'|'POST'} method
 * @param {string}       path   e.g. '/v1/orders'
 * @param {object|null}  body   JSON body (POST only)
 * @returns {Promise<object>}
 */
async function rzpFetch(method, path, body = null) {
  const MAX_RETRIES = 3;
  const payload = body ? JSON.stringify(body) : null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { statusCode, data } = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.razorpay.com',
        port: 443,
        path,
        method,
        headers: {
          'Authorization': AUTH,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      };

      const req = https.request(opts, res => {
        let buf = '';
        res.on('data', chunk => buf += chunk);
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(buf); } catch { parsed = { raw: buf }; }
          resolve({ statusCode: res.statusCode, data: parsed });
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(new Error('request timed out')); });

      if (payload) req.write(payload);
      req.end();
    });

    // 2xx → success
    if (statusCode >= 200 && statusCode < 300) return data;

    // 4xx → never retry, throw immediately
    if (statusCode >= 400 && statusCode < 500) {
      const msg = data?.error?.description || data?.error?.reason || JSON.stringify(data);
      throw new Error(`Razorpay ${statusCode}: ${msg}`);
    }

    // 5xx → retry with backoff (100ms × 2^attempt)
    if (attempt < MAX_RETRIES - 1) {
      const delay = 100 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error('Razorpay API returned 5xx after ' + MAX_RETRIES + ' retries');
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Create a Razorpay order.
 *
 * @param {object} opts
 * @param {number} opts.amount   Amount in **paise** (e.g. 50000 = ₹500).
 * @param {string} [opts.currency='INR']
 * @param {string} [opts.receipt]
 * @param {object} [opts.notes]
 * @returns {Promise<object>} Razorpay order object
 */
export async function createOrder({ amount, currency = 'INR', receipt, notes }) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be a positive integer in paise');
  return rzpFetch('POST', '/v1/orders', {
    amount,          // paise
    currency,
    receipt: receipt || 'rcpt_' + Date.now(),
    notes: notes || {},
  });
}

/**
 * Create a Razorpay payment link.
 *
 * @param {object} opts
 * @param {number} opts.amount     Amount in **paise** (e.g. 50000 = ₹500).
 * @param {object} [opts.customer] { name, email, contact }
 * @param {object} [opts.notes]
 * @returns {Promise<object>} Payment link object (includes `short_url`)
 */
export async function createPaymentLink({ amount, customer, notes }) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be a positive integer in paise');
  return rzpFetch('POST', '/v1/payment_links', {
    amount,          // paise
    currency: 'INR',
    description: 'Backstage payment',
    customer: customer || {},
    notes: notes || {},
    callback_url: '',
    callback_method: '',
  });
}

/**
 * Fetch a payment by ID.
 *
 * @param {string} id  e.g. 'pay_XXXXXXXXXXXXXXX'
 * @returns {Promise<object>} Payment object
 */
export async function fetchPayment(id) {
  if (!id) throw new Error('payment id is required');
  return rzpFetch('GET', '/v1/payments/' + encodeURIComponent(id));
}

/**
 * Verify a Razorpay webhook signature.
 * Uses HMAC-SHA256 and constant-time comparison via crypto.timingSafeEqual.
 *
 * @param {string|Buffer} rawBody    The raw request body (unparsed).
 * @param {string}        signature  The `X-Razorpay-Signature` header value.
 * @param {string}        secret     The webhook secret configured in the Razorpay dashboard.
 * @returns {{ valid: boolean, payload?: object }}
 */
export function verifyWebhook(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return { valid: false };

  const expected = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');

  if (sigBuf.length !== expBuf.length) return { valid: false };

  const valid = timingSafeEqual(sigBuf, expBuf);
  if (!valid) return { valid: false };

  let payload;
  try { payload = JSON.parse(rawBody); } catch { payload = null; }
  return { valid: true, payload };
}

/**
 * Start a minimal HTTP server that receives Razorpay webhooks.
 *
 * Handles: payment.captured, payment.failed, payment_link.paid.
 * Each is normalised to: { ts, type, customer_id, amount, method, order_id }
 *
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} opts.secret   Webhook secret from the Razorpay dashboard.
 * @param {function} opts.onEvent  Called with the normalised event object.
 * @returns {import('node:http').Server}
 */
export function startWebhookServer({ port, secret, onEvent }) {
  const HANDLED = new Set(['payment.captured', 'payment.failed', 'payment_link.paid']);

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end('method not allowed');
      return;
    }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const sig = req.headers['x-razorpay-signature'] || '';
      const { valid, payload } = verifyWebhook(body, sig, secret);

      if (!valid) {
        res.writeHead(401).end('invalid signature');
        return;
      }

      const eventType = payload?.event;
      if (!HANDLED.has(eventType)) {
        res.writeHead(200).end('ignored');
        return;
      }

      const entity = payload?.payload?.payment?.entity
                  || payload?.payload?.payment_link?.entity
                  || {};

      const normalised = {
        ts:          new Date().toISOString(),
        type:        eventType,
        customer_id: entity.customer_id || entity.email || null,
        amount:      entity.amount || 0,        // paise
        method:      entity.method || null,
        order_id:    entity.order_id || null,
      };

      try { onEvent(normalised); } catch { /* caller error, don't crash */ }

      res.writeHead(200).end('ok');
    });
  });

  server.listen(port, () => {
    console.log(`[rzp] webhook server listening on :${port}`);
  });

  return server;
}

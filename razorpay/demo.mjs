#!/usr/bin/env node
/**
 * razorpay/demo.mjs — Acceptance test for rzp.mjs.
 *
 * Run:  node --env-file=.env razorpay/demo.mjs
 *
 * What it does:
 *   1. Creates a Razorpay order (₹500 = 50000 paise)
 *   2. Creates a payment link for that order
 *   3. Starts a webhook server on :9090
 *   4. Prints the payment link URL — open it and pay with test card 4111 1111 1111 1111
 *   5. When the webhook fires, prints the normalised payment.captured event
 *   6. Demonstrates a bad signature being rejected
 *
 * Requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env (test-mode keys).
 */

import { createOrder, createPaymentLink, fetchPayment, verifyWebhook, startWebhookServer } from './rzp.mjs';

const sep = '─'.repeat(60);

async function main() {
  console.log('\n  Razorpay Test-Mode Demo');
  console.log('  ' + sep);

  // ── 1. Create order ──────────────────────────────────────────────
  console.log('\n  1. Creating order (₹500 = 50000 paise)…');
  const order = await createOrder({
    amount: 50000,    // paise
    currency: 'INR',
    receipt: 'demo_' + Date.now(),
    notes: { source: 'backstage-demo' },
  });
  console.log('     ✓ Order created:', order.id);
  console.log('     amount:', order.amount, 'paise (' + (order.amount / 100) + ' INR)');
  console.log('     status:', order.status);

  // ── 2. Create payment link ───────────────────────────────────────
  console.log('\n  2. Creating payment link…');
  const link = await createPaymentLink({
    amount: 50000,    // paise
    customer: { name: 'Test User', email: 'test@backstage.dev' },
    notes: { order_id: order.id, source: 'backstage-demo' },
  });
  console.log('     ✓ Payment link created:', link.id);
  console.log('     URL:', link.short_url);

  // ── 3. Bad signature rejection ───────────────────────────────────
  console.log('\n  3. Verifying bad signature is rejected…');
  const bad = verifyWebhook('{"event":"payment.captured"}', 'deadbeef'.repeat(8), 'wrong_secret');
  console.log('     Bad signature result:', bad);
  console.log('     ✓ Rejected as expected:', !bad.valid ? 'YES' : 'NO — THIS IS A BUG');

  // ── 4. Good signature round-trip ─────────────────────────────────
  console.log('\n  4. Verifying good signature…');
  const testSecret = 'test_webhook_secret_123';
  const testBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_test', amount: 50000, method: 'card', order_id: order.id } } } });
  const { createHmac } = await import('node:crypto');
  const goodSig = createHmac('sha256', testSecret).update(testBody).digest('hex');
  const good = verifyWebhook(testBody, goodSig, testSecret);
  console.log('     Good signature result:', good.valid ? '✓ VALID' : '✗ INVALID — BUG');

  // ── 5. Start webhook server ──────────────────────────────────────
  console.log('\n  5. Starting webhook server on :9090…');
  console.log('     Configure this URL in your Razorpay dashboard webhook settings.');
  console.log('     Or pay via the link above — the webhook will fire here.\n');

  const srv = startWebhookServer({
    port: 9090,
    secret: testSecret,
    onEvent(ev) {
      console.log('\n  ════════════════════════════════════════');
      console.log('  WEBHOOK EVENT RECEIVED');
      console.log('  ' + sep);
      console.log('  ', JSON.stringify(ev, null, 2));
      console.log('  ════════════════════════════════════════\n');
    },
  });

  console.log('  ' + sep);
  console.log('  Open the payment link in your browser:');
  console.log('  ' + (link.short_url || '(no URL returned — check Razorpay dashboard)'));
  console.log('  Use test card: 4111 1111 1111 1111, any future expiry, any CVV');
  console.log('  ' + sep);
  console.log('  Press Ctrl+C to stop.\n');
}

main().catch(e => {
  console.error('\n  ✗ Demo failed:', e.message || e);
  console.error('    Make sure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set in .env');
  console.error('    Get test keys at https://dashboard.razorpay.com/app/keys\n');
  process.exit(1);
});

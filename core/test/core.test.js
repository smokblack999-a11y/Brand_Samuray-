const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samurai-core-'));
process.env.DATA_DIR = dataDir;
process.env.COMMERCE_CURRENCY = 'KZT';
process.env.COMMERCE_PRODUCTS_JSON = JSON.stringify([{ id: 'test-product', name: 'Test product', priceKzt: 5000 }]);
process.env.COMMERCE_DELIVERY_ZONES_JSON = JSON.stringify({ 'test-zone': 700 });
process.env.COMMERCE_COURIER_IDS = '777';
process.env.COMMERCE_COURIER_TOKENS_JSON = JSON.stringify({ '777': 'test-courier-token-that-is-not-secret' });
process.env.COMMERCE_ADMIN_IDS = '888';
const commerce = require('../commerce');
const port = 18000 + Math.floor(Math.random() * 1000);
const API_KEY = 'test-core-api-key-123456';
const WEBHOOK_SECRET = 'test-webhook-secret-123456';

let child;
let childStdout = "";
let childStderr = "";

async function api(pathname, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: { 'X-API-Key': API_KEY, ...(options.headers || {}) }
  });
}

test.before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      AUTO_REPLY: 'false',
      OPENAI_API_KEY: '',
      CORE_API_KEY: API_KEY,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_WEBHOOK_SECRET: '',
      TELEGRAM_BOT_TOKEN: '',
      COMMERCE_PRODUCTS_JSON: JSON.stringify([{ id: 'test-product', name: 'Test product', priceKzt: 5000 }]),
      COMMERCE_DELIVERY_ZONES_JSON: JSON.stringify({ 'test-zone': 700 }),
      COMMERCE_COURIER_IDS: '777',
      COMMERCE_COURIER_TOKENS_JSON: JSON.stringify({ '777': 'test-courier-token-that-is-not-secret' }),
      COMMERCE_ADMIN_IDS: '888',
      MAX_MESSAGE_CHARS: '4000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { childStdout = (childStdout + chunk).slice(-8000); });
  child.stderr.on('data', chunk => { childStderr = (childStderr + chunk).slice(-8000); });

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(
      `server startup timeout; stdout=${childStdout || '(empty)'}; stderr=${childStderr || '(empty)'}`
    )), 10000);
    const onError = error => finish(error);
    const onExit = (code, signal) => finish(new Error(
      `server exited before startup (code=${code}, signal=${signal}); stdout=${childStdout || '(empty)'}; stderr=${childStderr || '(empty)'}`
    ));
    child.once('error', onError);
    child.once('exit', onExit);

    const check = async () => {
      if (settled) return;
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        if (r.ok) { finish(); return; }
      } catch {}
      if (!settled) setTimeout(check, 100);
    };
    check();
  });
});

test.after(() => child?.kill('SIGTERM'));

test('health endpoint', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'SamuraiOS Core');
  assert.equal(body.version, '2.7.0');
});

test('readiness endpoint verifies critical configuration', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/ready`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.ready, true);
});

test('protected API rejects missing key', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/stats`);
  assert.equal(r.status, 401);
});

test('lead analysis persists and stats update', async () => {
  const r = await api('/api/lead/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Сколько стоит? Хочу купить сегодня' })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.ok(body.saved.id);
  assert.ok(body.requestId);
  assert.ok(body.lead.score >= 0 && body.lead.score <= 100);

  const stats = await (await api('/api/stats')).json();
  assert.equal(stats.ok, true);
  assert.equal(stats.stats.total, 1);
  assert.equal(stats.stats.completed, 1);

  const leads = await (await api('/api/leads')).json();
  assert.equal(leads.ok, true);
  assert.equal(leads.leads.length, 1);
});

test('message length is bounded before scoring or AI', async () => {
  const r = await api('/api/lead/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(4001) })
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error.code, 'MESSAGE_TOO_LONG');
  assert.match(body.error.message, /максимум 4000/);
});

test('OpenAI health reports unconfigured without exposing secrets', async () => {
  const r = await api('/health/openai');
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.error.code, 'OPENAI_NOT_CONFIGURED');
  assert.equal('apiKey' in body, false);
});

test('Telegram webhook requires secret and deduplicates business messages', async () => {
  const update = {
    business_message: {
      business_connection_id: 'bc-test',
      message_id: 77,
      chat: { id: 123 },
      from: { id: 456 },
      text: 'Хочу купить сегодня'
    }
  };

  const denied = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
    body: JSON.stringify(update)
  });
  assert.equal(denied.status, 401);

  const first = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
    body: JSON.stringify(update)
  });
  assert.equal(first.status, 200);
  assert.ok(first.headers.get('x-request-id'));

  const second = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
    body: JSON.stringify(update)
  });
  assert.equal(second.status, 200);

  await new Promise(resolve => setTimeout(resolve, 100));
  const stats = await (await api('/api/stats')).json();
  assert.equal(stats.stats.total, 2);
  assert.equal(stats.stats.completed, 2);
  assert.equal(stats.stats.processing, 0);
  assert.equal(stats.stats.failed, 0);
  assert.equal(stats.stats.hot + stats.stats.warm + stats.stats.cold, 2);
});

test('commerce endpoints require API key and expose only configured catalog', async () => {
  const denied = await fetch(`http://127.0.0.1:${port}/api/commerce/orders`);
  assert.equal(denied.status, 401);

  const catalogResponse = await fetch(`http://127.0.0.1:${port}/api/commerce/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.deepEqual(catalog.products, [{ id: 'test-product', name: 'Test product', priceKzt: 5000, active: true }]);
  assert.deepEqual(catalog.deliveryZones, { 'test-zone': 700 });

  const statusResponse = await api('/api/commerce/status');
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.mode, 'stripe-test-only');
  assert.equal(status.catalog.count, 1);
  assert.equal(status.deliveryZones.count, 1);
  assert.equal(status.payment.testSecretConfigured, false);
  assert.equal(status.payment.webhookSecretConfigured, false);
  assert.equal(JSON.stringify(status).includes('test-courier-token-that-is-not-secret'), false);
  assert.equal(JSON.stringify(status).includes('STRIPE_SECRET_KEY='), false);
});

test('Stripe webhook fails closed when signature verification is not configured', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/commerce/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Stripe-Signature': 't=123,v1=invalid' },
    body: JSON.stringify({ id: 'evt_never_paid', type: 'checkout.session.completed' })
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'STRIPE_WEBHOOK_NOT_CONFIGURED');
});

test('courier photo upload rejects missing courier credentials before accepting a photo', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/commerce/orders/SAM-NOTREAL/photo-upload`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'COURIER_AUTH_REQUIRED');
});

test('courier photo upload rejects non-image bytes even with valid courier authentication', async () => {
  commerce.resetForTests();
  const order = commerce.createOrder({
    customerId: '500',
    productId: 'test-product',
    quantity: 1,
    fulfillment: 'delivery',
    address: 'Test address, 1',
    deliveryZone: 'test-zone'
  });
  commerce.attachCheckoutSession(order.id, 'cs_test_photo_guard');
  commerce.applyVerifiedPayment({
    verified: true, eventId: 'evt_photo_guard', orderId: order.id,
    sessionId: 'cs_test_photo_guard', amountKzt: 5700, currency: 'KZT'
  });
  commerce.assignCourier(order.id, '777');

  const response = await fetch(`http://127.0.0.1:${port}/api/commerce/orders/${order.id}/photo-upload`, {
    method: 'POST',
    headers: {
      'content-type': 'image/jpeg',
      'X-Courier-Id': '777',
      'X-Courier-Token': 'test-courier-token-that-is-not-secret'
    },
    body: Buffer.from('not a real jpeg')
  });
  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, 'PHOTO_CONTENT_MISMATCH');
});

test('courier orders API requires the individual token and returns only that courier active assigned orders', async () => {
  commerce.resetForTests();
  function makePaidDelivery(customerId, eventId, sessionId) {
    const order = commerce.createOrder({
      customerId,
      productId: 'test-product',
      quantity: 1,
      fulfillment: 'delivery',
      address: 'Private address for ' + customerId,
      deliveryZone: 'test-zone'
    });
    commerce.attachCheckoutSession(order.id, sessionId);
    commerce.applyVerifiedPayment({
      verified: true, eventId, orderId: order.id, sessionId,
      amountKzt: 5700, currency: 'KZT'
    });
    return order;
  }
  const assignedToCaller = makePaidDelivery('500', 'evt_courier_list_1', 'cs_test_courier_list_1');
  commerce.assignCourier(assignedToCaller.id, '777');
  const assignedElsewhere = makePaidDelivery('600', 'evt_courier_list_2', 'cs_test_courier_list_2');
  commerce.assignCourier(assignedElsewhere.id, '999');

  const noToken = await fetch(`http://127.0.0.1:${port}/api/commerce/courier/orders`, {
    headers: { 'X-Courier-Id': '777' }
  });
  assert.equal(noToken.status, 401);

  const wrongToken = await fetch(`http://127.0.0.1:${port}/api/commerce/courier/orders`, {
    headers: { 'X-Courier-Id': '777', 'X-Courier-Token': 'wrong-token' }
  });
  assert.equal(wrongToken.status, 401);

  const response = await fetch(`http://127.0.0.1:${port}/api/commerce/courier/orders`, {
    headers: { 'X-Courier-Id': '777', 'X-Courier-Token': 'test-courier-token-that-is-not-secret' }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.courierId, '777');
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].id, assignedToCaller.id);
  assert.equal(body.orders[0].address, 'Private address for 500');
  assert.equal(JSON.stringify(body).includes('Private address for 600'), false);
});

test('unknown route returns JSON 404', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.ok, false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samurai-core-'));
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
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      COMMERCE_PAYMENT_MODE: 'test',
      COMMERCE_OUTBOX_ENABLED: 'false',
      COMMERCE_DISPATCH_CHAT_ID: 'dispatch-test',
      AUTO_REPLY: 'false',
      OPENAI_API_KEY: '',
      CORE_API_KEY: API_KEY,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
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

test('unknown route returns JSON 404', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.ok, false);
});

test('protected commerce API supports a simulated-only payment and delivery lifecycle', async () => {
  const denied = await fetch(`http://127.0.0.1:${port}/api/commerce/products`);
  assert.equal(denied.status, 401);

  const productResponse = await api('/api/commerce/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'CORE-TEST-1', name: 'Core route test product', priceKzt: 2500, stock: 3 })
  });
  assert.equal(productResponse.status, 201);
  const productBody = await productResponse.json();
  assert.equal(productBody.ok, true);
  const product = productBody.product;

  const orderResponse = await api('/api/commerce/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: '777001',
      items: [{ productId: product.id, quantity: 2 }],
      fulfilment: 'delivery',
      address: 'Almaty, Example Street 1',
      phone: '+77000000001'
    })
  });
  assert.equal(orderResponse.status, 201);
  const created = (await orderResponse.json()).order;
  assert.equal(created.totalKzt, 5000);
  assert.equal(created.status, 'pending_payment');

  const badPayment = await api(`/api/commerce/orders/${created.id}/test-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventId: 'core-test-wrong-amount', amountKzt: 4999 })
  });
  assert.equal(badPayment.status, 409);
  assert.equal((await badPayment.json()).error.code, 'PAYMENT_AMOUNT_MISMATCH');

  const paymentPayload = {
    eventId: 'core-test-payment-1',
    amountKzt: 5000
  };
  const paidResponse = await api(`/api/commerce/orders/${created.id}/test-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(paymentPayload)
  });
  assert.equal(paidResponse.status, 200);
  const paidBody = await paidResponse.json();
  assert.equal(paidBody.simulated, true);
  assert.equal(paidBody.realMoneyMoved, false);
  assert.equal(paidBody.order.payment.status, 'paid');

  const duplicatePayment = await api(`/api/commerce/orders/${created.id}/test-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(paymentPayload)
  });
  assert.equal(duplicatePayment.status, 200);

  const assignedResponse = await api(`/api/commerce/orders/${created.id}/assign-courier`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ courierId: '888001' })
  });
  assert.equal(assignedResponse.status, 200);
  assert.equal((await assignedResponse.json()).order.status, 'assigned');

  const startedResponse = await api(`/api/commerce/orders/${created.id}/start-delivery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ courierId: '888001' })
  });
  assert.equal(startedResponse.status, 200);
  assert.equal((await startedResponse.json()).order.status, 'out_for_delivery');

  const fulfilledResponse = await api(`/api/commerce/orders/${created.id}/confirm-fulfilment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actorId: '888001', photoUrl: 'https://media.example.test/proof.jpg', note: 'test confirmation' })
  });
  assert.equal(fulfilledResponse.status, 200);
  assert.equal((await fulfilledResponse.json()).order.status, 'delivered');

  const outbox = await (await api('/api/commerce/outbox')).json();
  assert.equal(outbox.ok, true);
  assert.equal(outbox.events.length, 0);
  const persisted = JSON.parse(require('node:fs').readFileSync(require('node:path').join(dataDir, 'commerce.json'), 'utf8'));
  assert.equal(persisted.outbox.filter(event => event.type === 'PaymentConfirmed').length, 1);
  assert.equal(persisted.outbox.filter(event => event.type === 'OrderPlaced').length, 1);
  assert.equal(persisted.outbox.filter(event => event.type === 'OrderDelivered').length, 1);
});

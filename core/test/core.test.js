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
      DATA_DIR: dataDir,
      AUTO_REPLY: 'false',
      OPENAI_API_KEY: '',
      CORE_API_KEY: API_KEY,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      MAX_MESSAGE_CHARS: '4000',
      COMMERCE_ENABLED: 'true',
      COMMERCE_MODE: 'test'
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

test('Commerce API requires admin key and exposes demo catalog only when enabled', async () => {
  const denied = await fetch(`http://127.0.0.1:${port}/v1/commerce/catalog`);
  assert.equal(denied.status, 401);
  const r = await api('/v1/commerce/catalog');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.mode, 'test');
  assert.ok(body.products.some(p => p.sku === 'demo-digital-guide'));
  assert.ok(body.products.every(p => !('deliveryText' in p)));
});

test('Commerce API order lifecycle enforces lookup customerId and simulates payment idempotently', async () => {
  const created = await api('/v1/commerce/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'demo-digital-guide', quantity: 1, customerId: 'client-1' })
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const id = createdBody.order.id;
  assert.match(id, /^ord_[a-f0-9]{24}$/);
  assert.equal(createdBody.order.paymentMode, 'test_only_no_money_moved');

  const missingCustomer = await api(`/v1/commerce/orders/${id}`);
  assert.equal(missingCustomer.status, 400);
  const wrongOwner = await api(`/v1/commerce/orders/${id}?customerId=client-2`);
  assert.equal(wrongOwner.status, 404);
  const rightOwner = await api(`/v1/commerce/orders/${id}?customerId=client-1`);
  assert.equal(rightOwner.status, 200);
  assert.equal((await rightOwner.json()).order.id, id);

  const firstPayment = await api(`/v1/commerce/orders/${id}/simulate-payment`, { method: 'POST' });
  assert.equal(firstPayment.status, 200);
  const firstBody = await firstPayment.json();
  assert.equal(firstBody.order.status, 'fulfilled_test');
  assert.equal(firstBody.order.delivery.kind, 'digital_test');

  const secondPayment = await api(`/v1/commerce/orders/${id}/simulate-payment`, { method: 'POST' });
  assert.equal(secondPayment.status, 200);
  assert.equal((await secondPayment.json()).order.status, 'fulfilled_test');
});

test('Commerce API cancellation restores physical stock only once', async () => {
  const before = await (await api('/v1/commerce/catalog')).json();
  const initialStock = before.products.find(p => p.sku === 'demo-physical-box').stock;
  const created = await api('/v1/commerce/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'demo-physical-box', quantity: 1, customerId: 'client-1' })
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).order.id;
  const cancelled = await api(`/v1/commerce/orders/${id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'client-1' })
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).order.status, 'cancelled');
  const cancelledAgain = await api(`/v1/commerce/orders/${id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'client-1' })
  });
  assert.equal(cancelledAgain.status, 200);
  const after = await (await api('/v1/commerce/catalog')).json();
  assert.equal(after.products.find(p => p.sku === 'demo-physical-box').stock, initialStock);
});

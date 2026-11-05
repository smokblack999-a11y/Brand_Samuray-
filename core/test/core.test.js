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
      MAX_MESSAGE_CHARS: '4000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000);
    const check = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        if (r.ok) { clearTimeout(timer); resolve(); return; }
      } catch {}
      setTimeout(check, 100);
    };
    child.once('error', reject);
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
  assert.match(body.error?.message || '', /максимум 4000/);
});

test('OpenAI health reports unconfigured without exposing secrets', async () => {
  const r = await api('/health/openai');
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.configured, false);
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

test('commerce catalog, inventory and test-only payment are protected and deterministic', async () => {
  const created = await api('/api/commerce/products/DEMO-001', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test digital item', type: 'digital', priceMinor: 1999, currency: 'USD', stock: 2, deliveryPayload: 'TEST-DELIVERY-CONTENT' }) });
  assert.equal(created.status, 200);
  const product = (await created.json()).product;
  assert.equal(product.sku, 'DEMO-001');
  assert.equal('deliveryPayload' in product, false);
  const orderResponse = await api('/api/commerce/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: 'DEMO-001', quantity: 2, customerId: 'test-customer' }) });
  assert.equal(orderResponse.status, 201);
  const orderBody = await orderResponse.json();
  assert.equal(orderBody.order.paymentMode, 'test');
  assert.equal(orderBody.order.paymentStatus, 'pending');
  assert.match(orderBody.message, /no real payment/i);
  const oversell = await api('/api/commerce/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: 'DEMO-001', quantity: 1 }) });
  assert.equal(oversell.status, 409);
  assert.equal((await oversell.json()).error.code, 'OUT_OF_STOCK');
  const paidResponse = await api(`/api/commerce/orders/${orderBody.order.id}/test-pay`, { method: 'POST' });
  assert.equal(paidResponse.status, 200);
  const paid = await paidResponse.json();
  assert.equal(paid.order.paymentStatus, 'paid');
  assert.equal(paid.order.paymentMode, 'test');
  assert.equal(paid.delivery, 'TEST-DELIVERY-CONTENT');
  assert.match(paid.message, /does not charge money/i);
  const after = await api('/api/commerce/products');
  assert.equal((await after.json()).products.find(p => p.sku === 'DEMO-001').stock, 0);
});

test('commerce rejects invalid products and missing orders', async () => {
  const invalid = await api('/api/commerce/products/x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '', type: 'mystery', priceMinor: -1, currency: 'US', stock: -1 }) });
  assert.equal(invalid.status, 400);
  const missing = await api('/api/commerce/orders/not-real/test-pay', { method: 'POST' });
  assert.equal(missing.status, 404);
});

test('unknown route returns JSON 404', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.ok, false);
});

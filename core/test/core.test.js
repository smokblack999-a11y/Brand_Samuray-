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
    // Do not pipe child output without consuming it: a busy server can fill the pipe and block before /health is reachable.
    stdio: 'ignore'
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
  assert.equal(body.version, '2.8.0');
  assert.equal(body.revenueEngine, 'x27');
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

test('X33 reservation endpoint fails closed when economic consistency is disabled', async () => {
  const old = process.env.X33_ENABLED;
  delete process.env.X33_ENABLED;
  const r = await api('/api/x33/reserve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Tenant-Id': 'pilot-x33' },
    body: JSON.stringify({
      tenant_id: 'pilot-x33',
      event_id: 'event-1',
      estimate_micro: '1000000',
      ttl_ms: 60000
    })
  });
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.error.code, 'X33_DISABLED');
  if (old == null) delete process.env.X33_ENABLED;
  else process.env.X33_ENABLED = old;
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


test('X27 revenue loop persists decision, attributes outcome and deduplicates outcome event', async () => {
  const headers = { 'content-type': 'application/json', 'X-Tenant-Id': 'pilot-1' };
  const decisionResponse = await api('/api/revenue/decision', {
    method: 'POST', headers,
    body: JSON.stringify({ leadScore: 80, intent: 'hot', dealValue: 800000, grossMargin: 0.25, triggerRelevance: 0.8, contactAllowed: true })
  });
  assert.equal(decisionResponse.status, 201);
  const decisionBody = await decisionResponse.json();
  assert.equal(decisionBody.ok, true);
  assert.ok(decisionBody.decision.decisionId);

  const payload = {
    eventId: 'payment-evt-001',
    actionId: decisionBody.decision.decisionId,
    status: 'WON',
    revenueKZT: 800000,
    grossMarginRate: 0.25,
    baselineConversionProbability: 0.25,
    attributionPolicy: 'ASSISTED',
    actualCostKZT: 5000
  };
  const first = await api('/api/revenue/outcome', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.attribution.attributableGrossProfitKZT, 150000);
  assert.equal(firstBody.learning.actualCostKZT, 5000);

  const duplicate = await api('/api/revenue/outcome', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(duplicate.status, 200);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.inserted, false);

  const summary = await (await api('/api/revenue/summary', { headers: { 'X-Tenant-Id': 'pilot-1' } })).json();
  assert.equal(summary.ok, true);
  assert.equal(summary.summary.outcomes, 1);
  assert.equal(summary.summary.attributableGrossProfitKZT, 150000);
  assert.equal(summary.summary.actualCostKZT, 5000);

  const integrity = await (await api('/api/revenue/integrity', { headers: { 'X-Tenant-Id': 'pilot-1' } })).json();
  assert.equal(integrity.ok, true);
  assert.equal(integrity.integrity.ok, true);
  assert.equal(integrity.integrity.records, 4);
});
test('X28 revenue RCA exposes hypothesis, evidence and monetary risk', async () => {
  const r = await api('/api/revenue/rca', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Tenant-Id': 'pilot-rca' },
    body: JSON.stringify({
      responseSlaMinutes: 15,
      dealValue: 800000,
      baselineConversionProbability: 0.25,
      grossMargin: 0.25,
      events: [
        { type: 'customer.message', ts: '2026-10-03T10:00:00Z', payload: { text: 'Сколько стоит?' } },
        { type: 'manager.response', ts: '2026-10-03T10:45:00Z', payload: { text: 'Цена 800000' } }
      ]
    })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.rca.primaryHypothesis, 'RESPONSE_DELAY');
  assert.equal(body.rca.expectedGrossProfitAtRiskKZT, 50000);
  assert.equal(body.rca.causalityStatus, 'HYPOTHESIS_ONLY');
});
test('unknown route returns JSON 404', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.ok, false);
});

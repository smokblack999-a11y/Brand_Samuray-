const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'samuraios-'));

const { scoreLead } = require('../lead-engine');
const { saveLead, listLeads, stats } = require('../store');

test('lead engine scores a buying-intent message', () => {
  const result = scoreLead('Сколько стоит установка? Хочу заказать завтра');
  assert.ok(result.score >= 70);
  assert.equal(result.intent, 'hot');
});

test('lead store persists and reports leads', () => {
  const saved = saveLead({ message: 'test lead', score: 80, intent: 'hot' });
  assert.match(saved.id, /^\d+-[a-z0-9]+$/);
  assert.ok(saved.createdAt);
  assert.equal(listLeads(10).length, 1);
  assert.equal(stats().total, 1);
  assert.equal(stats().hot, 1);
});

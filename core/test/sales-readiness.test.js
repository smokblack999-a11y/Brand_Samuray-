const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReadiness, CHECKS } = require('../sales-readiness');

test('readiness score is evidence-based and never claims guaranteed sales', () => {
  const result = buildReadiness({});
  assert.equal(result.score, 0);
  assert.equal(result.band, 'prototype');
  assert.match(result.interpretation, /not a guaranteed probability/i);
  assert.equal(result.proof.total, CHECKS.length);
  assert.ok(result.missing.length > 0);
});

test('full evidence reaches sale-ready threshold with explicit confidence metadata', () => {
  const evidence = Object.fromEntries(CHECKS.map(([key]) => [key, true]));
  const result = buildReadiness(evidence);
  assert.equal(result.score, 100);
  assert.equal(result.band, 'sale-ready');
  assert.equal(result.uncertainty, 8);
  assert.equal(result.confidence, 92);
  assert.equal(result.missing.length, 0);
});

test('partial evidence identifies the highest-value missing proof', () => {
  const result = buildReadiness({
    api: true,
    webhook: true,
    lead_scoring: true,
    ai_reply: true,
    persistence: true,
    observability: true,
    security: true,
    tests: true,
    android_ci: true,
    artifact: true,
    docs: true,
    demo: true
  });
  const missingKeys = result.missing.map(x => x.key);
  assert.ok(missingKeys.includes('pilot'));
  assert.ok(missingKeys.includes('roi'));
  assert.equal(result.band, 'buyer-ready');
});

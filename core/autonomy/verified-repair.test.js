const test = require('node:test');
const assert = require('node:assert/strict');
const { planRepair } = require('./repair-engine');

test('repair candidate requires evidence, reproduction and passing tests', () => {
  const result = planRepair({
    log: 'ERROR: test failed: expected 2 received 3',
    changedFiles: ['core/example.js'],
    reproduction: true,
    testsPassed: true
  });
  assert.equal(result.verdict, 'REPAIR_CANDIDATE');
  assert.equal(result.safety.autoMerge, false);
  assert.equal(result.safety.autoDeploy, false);
  assert.equal(result.safety.autoPatch, false);
});

test('missing evidence stops automation', () => {
  const result = planRepair({ log: '', reproduction: false, testsPassed: false });
  assert.equal(result.verdict, 'HUMAN_REVIEW');
  assert.ok(result.reasons.includes('missing_failure_signature'));
});

test('blocked paths force human review', () => {
  const result = planRepair({
    log: 'fatal configuration error',
    changedFiles: ['.github/workflows/core.yml'],
    reproduction: true,
    testsPassed: true
  });
  assert.equal(result.verdict, 'HUMAN_REVIEW');
  assert.match(result.reasons.join(','), /blocked_paths/);
});

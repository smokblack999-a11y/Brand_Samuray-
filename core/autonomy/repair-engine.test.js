const test = require('node:test');
const assert = require('node:assert/strict');
const { planRepair, signature, blockedPath } = require('./repair-engine');

test('extracts a stable failure signature', () => {
  assert.equal(signature('build\nError: module not found\nstack'), 'Error: module not found');
});

test('stops when evidence is incomplete', () => {
  const result = planRepair({ log: 'Error: timeout', changedFiles: ['core/server.js'], testsPassed: false, reproduction: false });
  assert.equal(result.verdict, 'HUMAN_REVIEW');
  assert.ok(result.reasons.includes('tests_not_passing'));
});

test('allows a repair candidate only with evidence', () => {
  const result = planRepair({
    log: 'Error: expected 200 got 500',
    changedFiles: ['core/server.js'],
    testsPassed: true,
    reproduction: true
  });
  assert.equal(result.verdict, 'REPAIR_CANDIDATE');
  assert.equal(result.safety.autoMerge, false);
});

test('blocks sensitive paths', () => {
  assert.equal(blockedPath('.env'), true);
  assert.equal(blockedPath('.github/workflows/repair.yml'), true);
  assert.equal(blockedPath('core/server.js'), false);
});

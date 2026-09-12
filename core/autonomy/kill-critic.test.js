const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('./kill-critic');

test('rejects missing tests', () => {
  assert.equal(inspect({ files: ['core/server.js'], testsPassed: false, failureSignature: 'Error', patchLines: 10 }).verdict, 'REJECT');
});

test('rejects sensitive file changes', () => {
  const result = inspect({ files: ['.env'], testsPassed: true, failureSignature: 'Error', patchLines: 1 });
  assert.equal(result.verdict, 'REJECT');
  assert.match(result.violations[0], /sensitive_files/);
});

test('passes a small verified change', () => {
  const result = inspect({ files: ['core/server.js'], testsPassed: true, failureSignature: 'Error: timeout', patchLines: 30 });
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.constraints.autoMerge, false);
});

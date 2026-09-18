const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('./diagnose');

test('parses strict JSON', () => {
  assert.deepEqual(extractJson('{"confidence":0.9}'), { confidence: 0.9 });
});

test('extracts JSON from fenced model output', () => {
  const value = extractJson('```json\n{"root_cause":"timeout"}\n```');
  assert.equal(value.root_cause, 'timeout');
});

test('rejects non-JSON model output', () => {
  assert.throws(() => extractJson('not json'), /MODEL_OUTPUT_NOT_JSON/);
});

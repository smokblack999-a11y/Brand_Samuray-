const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeIncident, toRecoveryDiagnosis, reduce } = require("../x10think-recovery");

test("X10THINK produces deterministic diagnosis and fingerprint", () => {
  const input = {
    repository:"acme/app",
    workflow:"CI",
    runId:123,
    branch:"main",
    sha:"abc123",
    logs:"Error: Module not found: foo.js\n at build.js:10"
  };
  const a=analyzeIncident(input);
  const b=analyzeIncident(input);
  assert.equal(a.fingerprint,b.fingerprint);
  assert.equal(a.incident.type,"dependency_error");
  assert.equal(a.incident.confidence > 0.5,true);
  assert.equal(a.checkpoints.length,1);
  assert.equal(a.checkpoints[0].type,"x10think.checkpoint");
});

test("X10THINK exposes structured recovery diagnosis", () => {
  const state=analyzeIncident({
    repository:"acme/app",
    workflow:"test",
    runId:1,
    branch:"main",
    sha:"sha",
    logs:"AssertionError: expected 1 to equal 2"
  });
  const d=toRecoveryDiagnosis(state);
  assert.equal(d.errorType,"test_failure");
  assert.equal(Array.isArray(d.trace),true);
  assert.equal(typeof d.stateHash,"string");
});

test("reducer changes state without mutating the source", () => {
  const state=analyzeIncident({logs:"timeout"});
  const next=reduce(state,{stage:"candidate"});
  assert.notEqual(next,state);
  assert.equal(state.stage,"diagnosed");
  assert.equal(next.stage,"candidate");
});

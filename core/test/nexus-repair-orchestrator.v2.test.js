"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const o = require("../nexus-repair-orchestrator");

test("failure -> critic -> sandbox -> CI -> proof -> review", () => {
  let j = o.createJob({resource:"github://repo/pull/1",changedFiles:["src/app.js"],headSha:"abc"});
  j = o.nextState(j,"DIAGNOSING");
  j = o.evaluateRepair(j,{diff:"+ safeFix();"}).job;
  assert.equal(j.state,"SANDBOX_REQUIRED");
  j = o.recordSandbox(j,{passed:true,runId:10});
  j = o.recordCI(j,{conclusion:"success",runId:11});
  const out = o.finalizeProof(j,{afterSha:"def"});
  assert.equal(out.job.state,"READY_FOR_REVIEW");
  assert.match(out.receipt.proofHash,/^[a-f0-9]{64}$/);
});

test("dangerous patch is blocked before sandbox", () => {
  let j = o.createJob({resource:"github://repo/pull/2",changedFiles:["src/app.js"]});
  j = o.nextState(j,"DIAGNOSING");
  const out = o.evaluateRepair(j,{diff:"+ rm -rf /"});
  assert.equal(out.evaluation.decision,"BLOCK");
  assert.equal(out.job.state,"CRITIC_BLOCKED");
});

test("CI failure cannot create proof", () => {
  let j = o.createJob({resource:"github://repo/pull/3",changedFiles:["src/app.js"]});
  j = o.nextState(j,"DIAGNOSING");
  j = o.evaluateRepair(j,{diff:"+ safeFix();"}).job;
  j = o.recordSandbox(j,{passed:true});
  j = o.recordCI(j,{conclusion:"failure"});
  assert.equal(j.state,"CI_FAILED");
  assert.throws(() => o.finalizeProof(j),/proof_requires_ci_success/);
});

test("retry budget stops repeated failures", () => {
  let j = o.createJob({resource:"github://repo/pull/4",changedFiles:["src/app.js"]},{maxAttempts:1});
  j = o.nextState(j,"DIAGNOSING");
  j = o.evaluateRepair(j,{diff:"+ safeFix();"}).job;
  j = o.recordSandbox(j,{passed:true});
  j = o.recordCI(j,{conclusion:"failure"});
  assert.equal(j.state,"STOPPED");
});

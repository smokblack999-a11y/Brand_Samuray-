"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const evidence = require("./agent-evidence");
const intent = require("./agent-intent");

test("evidence chain verifies after append", () => {
  let chain = evidence.createChain({subject:"agent:test", intent:"repair_ci_failure", initialEvidence:{source:"test"}});
  const appended = evidence.append(chain, {
    type:"verification",
    intent:"repair_ci_failure",
    action:"sandbox_execute",
    decision:"ALLOW_CI",
    evidence:{runId:42, passed:true}
  });
  chain = appended.chain;
  assert.equal(evidence.verify(chain), true);
  assert.equal(chain.records.length, 2);
});

test("evidence chain detects tampering", () => {
  const chain = evidence.createChain({subject:"agent:test", intent:"repair"});
  const appended = evidence.append(chain, {type:"decision", intent:"repair", action:"allow", decision:"ALLOW", evidence:{ok:true}});
  appended.chain.records[1].decision = "BLOCK";
  assert.equal(evidence.verify(appended.chain), false);
});

test("intent/action mismatch blocks semantic scope expansion", () => {
  const result = intent.analyze({
    intent: "fix failing authentication test",
    changedFiles: ["tests/auth.test.js", "src/auth/token.js", "src/permissions/rbac.js"]
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "action_scope_exceeds_intent");
  assert.deepEqual(result.undeclaredScopes, ["authorization"]);
});

test("matching intent/action scope is allowed", () => {
  const result = intent.analyze({
    intent: "fix authentication test",
    changedFiles: ["tests/auth.test.js", "src/auth/token.js"]
  });
  assert.equal(result.decision, "ALLOW");
});

"use strict";

const assert = require("node:assert/strict");
const {
  evaluatePolicy,
  evaluateTransition,
  inspectChange
} = require("../core/nexus-resource-control");

const resource = {
  id: "github://example/repo/pull/1",
  type: "pull_request"
};

assert.equal(
  evaluateTransition("CI_FAILED", "PROPOSE_PATCH", "AI_PATCH_PROPOSED"),
  true
);

assert.equal(
  evaluateTransition("CI_FAILED", "DEPLOY", "DEPLOYED"),
  false
);

const critical = inspectChange({
  files: [
    "src/auth/session.js",
    "README.md"
  ]
});

assert.equal(critical.critical, true);
assert.deepEqual(critical.criticalFiles, ["src/auth/session.js"]);

const blocked = evaluatePolicy({
  resource,
  state: "CI_FAILED",
  action: "DEPLOY",
  change: { files: ["src/auth/session.js"] }
});

assert.equal(blocked.allow, false);
assert.ok(blocked.reasons.includes("deploy-from-failed-state"));
assert.ok(blocked.reasons.includes("code-change-requires-ci-pass"));

const proposal = evaluatePolicy({
  resource,
  state: "CI_FAILED",
  action: "PROPOSE_PATCH",
  change: { files: ["src/auth/session.js"] }
});

assert.equal(proposal.allow, true);

console.log("nexus-resource-control: PASS");

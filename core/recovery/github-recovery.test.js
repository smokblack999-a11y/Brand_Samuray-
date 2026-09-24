"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "x10thinc-recovery-")
);

const {
  verifyGitHubSignature,
  ingestWorkflowRun,
  buildRca,
  killCritic,
  getRecoveryStats,
} = require("./github-recovery");

test("GitHub signature verification accepts a valid HMAC", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const secret = "test-secret";
  const signature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(
    verifyGitHubSignature(body, signature, secret),
    true
  );

  assert.equal(
    verifyGitHubSignature(body, "sha256=bad", secret),
    false
  );
});

test("workflow_run failure produces deterministic RCA", () => {
  const payload = {
    action: "completed",
    repository: { full_name: "smokblack999-a11y/Brand_Samuray-" },
    workflow_run: {
      id: 123,
      name: "SamuraiOS Core CI",
      conclusion: "failure",
      head_sha: "abc123",
      head_branch: "main",
      html_url: "https://github.com/example/run/123",
    },
  };

  const result = buildRca(payload);

  assert.equal(result.schema, "x10thinc.github.recovery.v1");
  assert.equal(result.classification.status, "failed");
  assert.equal(result.classification.severity, "high");
  assert.equal(result.rca.confidence, "low");
  assert.equal(result.kill_critic.allowed, true);
});

test("Kill Critic blocks dangerous actions", () => {
  const result = killCritic("rm -rf production");

  assert.equal(result.allowed, false);
  assert.deepEqual(result.violations, ["rm -rf"]);
});

test("workflow delivery is deduplicated", () => {
  const payload = {
    action: "completed",
    repository: { full_name: "example/repo" },
    workflow_run: {
      id: 456,
      name: "CI",
      conclusion: "failure",
      head_sha: "deadbeef",
      head_branch: "main",
    },
  };

  const first = ingestWorkflowRun(payload, "delivery-456");
  const second = ingestWorkflowRun(payload, "delivery-456");

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);

  const stats = getRecoveryStats();
  assert.equal(stats.total, 1);
  assert.equal(stats.failed, 1);
});

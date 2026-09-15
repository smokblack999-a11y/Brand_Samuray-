const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-interop-"));
process.env.DATA_DIR = dataDir;

const { verifySignature, normalizeWorkflowRun, handleWorkflowRun } = require("./github-webhook");
const { list } = require("./store");

test("verifies GitHub HMAC signature", () => {
  const secret = "test-secret";
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifySignature(secret, body, signature), true);
  assert.equal(verifySignature(secret, body, "sha256=bad"), false);
});

test("normalizes failed workflow_run without credentials", () => {
  const normalized = normalizeWorkflowRun({
    action: "completed",
    repository: { full_name: "acme/site" },
    workflow_run: {
      id: 123,
      name: "CI",
      conclusion: "failure",
      head_sha: "abc123",
      head_repository: { full_name: "acme/site" },
      pull_requests: [{ number: 7 }],
      html_url: "https://github.com/acme/site/actions/runs/123"
    }
  }, "delivery-1");

  assert.equal(normalized.job.type, "CI_FAILURE");
  assert.equal(normalized.job.repository, "acme/site");
  assert.equal(normalized.job.pullRequest, 7);
  assert.equal(normalized.job.commit, "abc123");
  assert.equal("token" in normalized.job, false);
  assert.equal("password" in normalized.job, false);
});

test("deduplicates the same GitHub delivery", () => {
  const payload = {
    action: "completed",
    repository: { full_name: "acme/site" },
    workflow_run: {
      id: 456,
      name: "CI",
      conclusion: "failure",
      head_sha: "def456",
      head_repository: { full_name: "acme/site" },
      pull_requests: []
    }
  };

  const first = handleWorkflowRun(payload, "delivery-2");
  const second = handleWorkflowRun(payload, "delivery-2");
  assert.equal(first.accepted, true);
  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, false);
  assert.equal(list(10).length, 1);
});

test("ignores successful workflow_run events", () => {
  const result = handleWorkflowRun({ action: "completed", workflow_run: { id: 1, conclusion: "success" } }, "delivery-3");
  assert.equal(result.accepted, false);
});

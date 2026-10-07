"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const SECRET = "x10think-github-webhook-test-secret";
process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.AGENT_CONTROL_WEBHOOK_SECRET = SECRET;
process.env.CORE_API_KEY = "test-core-api-key";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-telegram-secret";

const { server } = require("./server");

function signature(body) {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

test.after(() => server.close());

test("GitHub workflow_run webhook accepts valid signature and deduplicates delivery", async () => {

  const port = server.address().port;
  const payload = {
    workflow_run: {
      id: 990000001,
      name: "X10THINK webhook integration test",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_branch: "x10think-e2e-sandbox-integration",
      head_sha: "4b8b6e967ca60540269f2cd7e42457996b7835c1",
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
    }
  };
  const body = JSON.stringify(payload);

  const first = await fetch(`http://127.0.0.1:${port}/api/agent-control/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": "e2e-delivery-990000001",
      "x-hub-signature-256": signature(body)
    },
    body
  });
  assert.equal(first.status, 202);
  const firstJson = await first.json();
  assert.equal(firstJson.ok, true);
  assert.equal(firstJson.duplicate, false);
  assert.equal(firstJson.job.workflow.id, 990000001);

  const duplicate = await fetch(`http://127.0.0.1:${port}/api/agent-control/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": "e2e-delivery-990000001",
      "x-hub-signature-256": signature(body)
    },
    body
  });
  assert.equal(duplicate.status, 200);
  const duplicateJson = await duplicate.json();
  assert.equal(duplicateJson.ok, true);
  assert.equal(duplicateJson.duplicate, true);
});

test("GitHub workflow_run webhook fails closed on invalid signature", async () => {
  const port = server.address().port;
  const body = JSON.stringify({
    workflow_run: {
      id: 990000002,
      name: "invalid signature test",
      conclusion: "failure",
      repository: { full_name: "smokblack999-a11y/Brand_Samuray-" }
    }
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/agent-control/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": "e2e-delivery-990000002",
      "x-hub-signature-256": "sha256=invalid"
    },
    body
  });
  assert.equal(response.status, 401);
  const json = await response.json();
  assert.equal(json.error.code, "INVALID_GITHUB_SIGNATURE");
});

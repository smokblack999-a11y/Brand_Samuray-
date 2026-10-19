"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createCiAgent, verifyGitHubSignature, normalizeWorkflowRun } = require("../ci-agent");

function signed(secret, body) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function request(body, secret, delivery = "delivery-1", eventType = "workflow_run") {
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    rawBody,
    body,
    get(name) {
      return ({
        "X-Hub-Signature-256": signed(secret, rawBody),
        "X-GitHub-Delivery": delivery,
        "X-GitHub-Event": eventType
      })[name];
    }
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function failedRun(overrides = {}) {
  return {
    action: "completed",
    repository: { full_name: "acme/service" },
    workflow_run: {
      id: 123,
      name: "CI",
      status: "completed",
      conclusion: "failure",
      run_number: 7,
      html_url: "https://github.com/acme/service/actions/runs/123",
      head_branch: "main",
      head_sha: "abc123",
      event: "push",
      ...overrides
    }
  };
}

test("GitHub signature verification rejects tampered body and wrong secret", () => {
  const secret = "test-github-secret";
  const body = Buffer.from('{"action":"completed"}');
  assert.equal(verifyGitHubSignature(secret, body, signed(secret, body)), true);
  assert.equal(verifyGitHubSignature("wrong", body, signed(secret, body)), false);
  assert.equal(verifyGitHubSignature(secret, Buffer.from("{}"), signed(secret, body)), false);
});

test("only completed failed workflow runs are normalized", () => {
  assert.ok(normalizeWorkflowRun(failedRun()));
  assert.equal(normalizeWorkflowRun({ ...failedRun(), workflow_run: { ...failedRun().workflow_run, conclusion: "success" } }), null);
  assert.equal(normalizeWorkflowRun({ ...failedRun(), workflow_run: { ...failedRun().workflow_run, status: "in_progress" } }), null);
});

test("webhook authenticates, records real failed run and deduplicates deliveries", () => {
  const secret = "test-github-secret";
  const ci = createCiAgent({ secret, analyzer: async () => "test suggestion" });
  const req = request(failedRun(), secret);
  const first = response();
  ci.webhook(req, first);
  assert.equal(first.statusCode, 202);
  assert.equal(first.body.accepted, true);
  assert.equal(ci.listEvents().length, 1);
  assert.equal(ci.listEvents()[0].repository, "acme/service");

  const duplicate = response();
  ci.webhook(req, duplicate);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(ci.listEvents().length, 1);
});

test("webhook rejects invalid signatures and ignores successful runs", () => {
  const secret = "test-github-secret";
  const ci = createCiAgent({ secret });
  const bad = request(failedRun(), "wrong-secret");
  const denied = response();
  ci.webhook(bad, denied);
  assert.equal(denied.statusCode, 401);

  const successReq = request(failedRun({ conclusion: "success" }), secret, "delivery-2");
  const ignored = response();
  ci.webhook(successReq, ignored);
  assert.equal(ignored.statusCode, 202);
  assert.equal(ignored.body.accepted, false);
  assert.equal(ci.listEvents().length, 0);
});

test("AI analysis returns a suggestion, never a fixed status", async () => {
  const ci = createCiAgent({ secret: "secret", analyzer: async (event, logs) => {
    assert.equal(event.id, "123");
    assert.match(logs, /Module not found/);
    return "Check the import path.";
  }});
  const req = request(failedRun(), "secret");
  const res = response();
  ci.webhook(req, res);
  const result = await ci.analyze("123", "Module not found");
  assert.equal(result.status, "suggestion_only");
  assert.equal(result.suggestion, "Check the import path.");
  await assert.rejects(ci.analyze("999", ""), { code: "CI_EVENT_NOT_FOUND" });
});


test("failed webhook queues background analysis and exposes suggestion-only result", async () => {
  let calls = 0;
  const ci = createCiAgent({
    secret: "secret",
    processFailure: async event => {
      calls++;
      assert.equal(event.id, "123");
      return { suggestion: "Inspect the failing import.", logsFetched: true, critic: { decision: "REVIEW_REQUIRED", findings: [] } };
    }
  });
  const res = response();
  ci.webhook(request(failedRun(), "secret"), res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.queued, true);
  assert.ok(["queued", "running", "suggestion_only"].includes(res.body.event.analysis.status));

  for (let i = 0; i < 30 && ci.listEvents()[0].analysis.status !== "suggestion_only"; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const event = ci.listEvents()[0];
  assert.equal(event.analysis.status, "suggestion_only");
  assert.equal(event.analysis.suggestion, "Inspect the failing import.");
  assert.equal(event.analysis.critic.decision, "REVIEW_REQUIRED");
  assert.equal(calls, 1);
});

test("background queue retries once and records a bounded failure state", async () => {
  let calls = 0;
  const ci = createCiAgent({
    secret: "secret",
    processFailure: async () => {
      calls++;
      const error = new Error("private details must not be stored");
      error.code = "UPSTREAM_DOWN";
      throw error;
    }
  });
  const res = response();
  ci.webhook(request(failedRun(), "secret"), res);
  for (let i = 0; i < 50 && ci.listEvents()[0].analysis.status !== "failed"; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const event = ci.listEvents()[0];
  assert.equal(event.analysis.status, "failed");
  assert.equal(event.analysis.attempts, 2);
  assert.equal(event.analysis.errorCode, "UPSTREAM_DOWN");
  assert.equal(JSON.stringify(event.analysis).includes("private details"), false);
  assert.equal(calls, 2);
});

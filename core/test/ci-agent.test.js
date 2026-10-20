"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createCiAgentStore } = require("../ci-agent-store");
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


test("durable store restores queued work and remembers webhook deliveries", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-agent-store-"));
  const stateFile = path.join(dir, "state.json");
  const store = createCiAgentStore(stateFile);
  const event = normalizeWorkflowRun(failedRun());
  event.analysis = { status: "queued", attempts: 0, queuedAt: new Date().toISOString() };
  store.save({ events: [event], deliveries: ["delivery-previous"] });

  let calls = 0;
  const ci = createCiAgent({
    secret: "secret",
    stateFile,
    processFailure: async recovered => {
      calls++;
      assert.equal(recovered.id, "123");
      return { suggestion: "Recovered after restart", logsFetched: true };
    }
  });

  const duplicate = response();
  ci.webhook(request(failedRun(), "secret", "delivery-previous"), duplicate);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.duplicate, true);

  for (let i = 0; i < 40 && ci.listEvents()[0]?.analysis.status !== "suggestion_only"; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(ci.listEvents()[0].analysis.status, "suggestion_only");
  assert.equal(ci.listEvents()[0].analysis.suggestion, "Recovered after restart");
  assert.equal(calls, 1);
  const persisted = store.load();
  assert.equal(persisted.events[0].analysis.status, "suggestion_only");
  fs.rmSync(dir, { recursive: true, force: true });
});


test("same workflow run is not re-enqueued under a different delivery ID", async () => {
  let calls = 0;
  const ci = createCiAgent({
    secret: "secret",
    processFailure: async () => {
      calls++;
      return { suggestion: "One analysis only" };
    }
  });
  const first = response();
  ci.webhook(request(failedRun(), "secret", "delivery-first"), first);
  assert.equal(first.statusCode, 202);
  for (let i = 0; i < 40 && ci.listEvents()[0]?.analysis.status !== "suggestion_only"; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const duplicate = response();
  ci.webhook(request(failedRun(), "secret", "delivery-second"), duplicate);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.duplicateRun, true);
  assert.equal(ci.listEvents().length, 1);
  assert.equal(ci.listEvents()[0].analysis.suggestion, "One analysis only");
  assert.equal(calls, 1);
});


test("durable store fails closed on corrupted state instead of silently resetting it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-agent-corrupt-"));
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(stateFile, "{not-json", { mode: 0o600 });
  assert.throws(() => createCiAgentStore(stateFile).load());
  fs.rmSync(dir, { recursive: true, force: true });
});


test("durable store rejects invalid state on save", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-agent-invalid-save-"));
  const store = createCiAgentStore(path.join(dir, "state.json"));
  assert.throws(() => store.save({ events: "not-an-array", deliveries: [] }), { code: "CI_AGENT_STATE_INVALID" });
  fs.rmSync(dir, { recursive: true, force: true });
});



test("restart recovery never restores more than the configured queue bound", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-agent-capacity-"));
  const stateFile = path.join(dir, "state.json");
  const store = createCiAgentStore(stateFile);
  const events = Array.from({ length: 55 }, (_, index) => {
    const event = normalizeWorkflowRun(failedRun({
      id: 1000 + index,
      html_url: `https://github.com/acme/service/actions/runs/${1000 + index}`
    }));
    event.analysis = { status: "queued", attempts: 0, queuedAt: new Date().toISOString() };
    return event;
  });
  store.save({ events, deliveries: [] });

  const ci = createCiAgent({
    secret: "secret",
    stateFile,
    processFailure: async event => ({ suggestion: `Suggestion for ${event.id}` })
  });

  for (let i = 0; i < 100 && ci.listEvents(200).some(event => event.analysis.status === "queued" || event.analysis.status === "running"); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const restored = ci.listEvents(200);
  assert.equal(restored.length, 55);
  assert.equal(restored.filter(event => event.analysis.status === "queue_full").length, 5);
  assert.equal(restored.filter(event => event.analysis.status === "suggestion_only").length, 50);
  assert.ok(restored.filter(event => event.analysis.status === "queue_full").every(event => event.analysis.errorCode === "CI_QUEUE_CAPACITY_ON_RECOVERY"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("failed atomic save preserves the previous state and removes its temporary file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-agent-atomic-save-"));
  const stateFile = path.join(dir, "state.json");
  const store = createCiAgentStore(stateFile);
  store.save({ events: [{ id: "previous" }], deliveries: ["delivery-previous"] });
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = () => {
      const error = new Error("simulated rename failure");
      error.code = "EIO";
      throw error;
    };
    assert.throws(() => store.save({ events: [{ id: "replacement" }], deliveries: [] }), { code: "EIO" });
  } finally {
    fs.renameSync = originalRename;
  }
  assert.deepEqual(store.load().events.map(event => event.id), ["previous"]);
  assert.deepEqual(store.load().deliveries, ["delivery-previous"]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["state.json"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("background worker pauses without an unhandled rejection when durable save fails", async () => {
  let saves = 0;
  let processCalls = 0;
  const store = {
    load: () => ({ events: [], deliveries: [] }),
    save: () => {
      saves++;
      // Constructor, enqueue, and webhook final save succeed; saving the running
      // state fails before processFailure is invoked.
      if (saves === 4) {
        const error = new Error("raw filesystem details must not escape");
        error.code = "EIO";
        throw error;
      }
    }
  };
  const ci = createCiAgent({
    secret: "secret",
    store,
    processFailure: async () => {
      processCalls++;
      return { suggestion: "should not run before durable running state is saved" };
    }
  });

  const first = response();
  ci.webhook(request(failedRun(), "secret", "delivery-storage-fault"), first);
  assert.equal(first.statusCode, 202);

  for (let i = 0; i < 40 && ci.listEvents()[0]?.analysis.status !== "failed"; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const event = ci.listEvents()[0];
  assert.equal(event.analysis.status, "failed");
  assert.equal(event.analysis.errorCode, "CI_STATE_PERSIST_FAILED");
  assert.equal(processCalls, 0);

  const second = response();
  ci.webhook(request(failedRun({ id: 456, html_url: "https://github.com/acme/service/actions/runs/456" }), "secret", "delivery-after-storage-fault"), second);
  assert.equal(second.statusCode, 503);
  assert.equal(second.body.error.code, "CI_STATE_PERSIST_FAILED");
});


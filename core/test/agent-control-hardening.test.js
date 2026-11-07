const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-agent-control-"));
process.env.DATA_DIR = dataDir;
const modulePath = require.resolve("../agent-control");
let agent = require("../agent-control");

function event(id, conclusion = "failure") {
  return {
    workflow_run: {
      id, name: "SamuraiOS Core CI", event: "push", status: "completed",
      conclusion, head_branch: "test", head_sha: "a".repeat(40),
      repository: { full_name: "owner/repo" },
      actor: { login: "test-user" }, html_url: "https://example.invalid/run"
    }
  };
}

test("GitHub webhook HMAC accepts only exact raw-body signature", () => {
  const crypto = require("node:crypto");
  const raw = Buffer.from('{"ok":true}');
  const secret = "test-secret";
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(agent.verifyGithubSignature(raw, signature, secret), true);
  assert.equal(agent.verifyGithubSignature(Buffer.from('{"ok":false}'), signature, secret), false);
  assert.equal(agent.verifyGithubSignature(raw, signature, ""), false);
});

test("workflow delivery is idempotent and survives module restart", () => {
  const first = agent.ingestWorkflowRun(event(101), "delivery-101");
  assert.equal(first.duplicate, false);
  const duplicate = agent.ingestWorkflowRun(event(101), "delivery-101");
  assert.equal(duplicate.duplicate, true);
  delete require.cache[modulePath];
  agent = require("../agent-control");
  assert.equal(agent.listJobs(10).length, 1);
  assert.equal(agent.getJob(first.job.id).workflow.id, 101);
});

test("incomplete final JSONL record is truncated without losing prior records", () => {
  agent.ingestWorkflowRun(event(102), "delivery-102");
  const queue = path.join(dataDir, "agent-control-queue.jsonl");
  fs.appendFileSync(queue, '{"type":"INGEST","job":');
  delete require.cache[modulePath];
  agent = require("../agent-control");
  assert.equal(agent.listJobs(10).length, 2);
  assert.ok(fs.readFileSync(queue, "utf8").endsWith("\n"));
});

test("corruption in a completed JSONL record fails closed", () => {
  const queue = path.join(dataDir, "agent-control-queue.jsonl");
  fs.writeFileSync(queue, '{"broken":}\n', "utf8");
  assert.throws(() => agent.listJobs(10), { code: "AGENT_CONTROL_QUEUE_CORRUPT" });
});

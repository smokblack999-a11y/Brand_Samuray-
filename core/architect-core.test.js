"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ArchitectCore, STATUS, DECISION } = require("./architect-core");

function adapters({ critic = { decision: DECISION.ALLOW }, proof = { verified: true, evidence: [{ type: "test", ok: true }] } } = {}) {
  const saved = [];
  return {
    saved,
    planner: {
      async plan() {
        return { actions: ["build"], tests: ["unit"] };
      },
    },
    critic: {
      async evaluate() {
        return critic;
      },
    },
    executor: {
      async execute() {
        return { patch: "proposal" };
      },
    },
    verifier: {
      async verify() {
        return proof;
      },
    },
    store: {
      async save(job) {
        saved.push(job);
      },
    },
  };
}

test("proves a mission only after verifier evidence", async () => {
  const a = adapters();
  const core = new ArchitectCore({ ...a, maxAttempts: 2 });

  const result = await core.run({
    id: "job-1",
    type: "repair",
    input: { repo: "demo" },
  });

  assert.equal(result.status, STATUS.PROVEN);
  assert.equal(result.attempts, 1);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.events.at(-1).event, "PROOF_ACCEPTED");
});

test("planner output is normalized for X28 handoff", async () => {
  const a = adapters();
  a.planner.plan = async () => ({ actions: ["patch"] });
  const core = new ArchitectCore({ ...a, maxAttempts: 1 });
  const result = await core.run({ id: "job-plan", type: "repair", input: {} });
  assert.deepEqual(result.plan.tests, []);
  assert.deepEqual(result.plan.constraints, []);
  assert.equal(result.status, STATUS.PROVEN);
});

test("critic rejection prevents execution", async () => {
  const a = adapters({ critic: { decision: DECISION.REJECT } });
  let executions = 0;
  a.executor.execute = async () => {
    executions += 1;
    return {};
  };

  const core = new ArchitectCore({ ...a, maxAttempts: 2 });
  const result = await core.run({ id: "job-2", type: "repair", input: {} });

  assert.equal(result.status, STATUS.REJECTED);
  assert.equal(executions, 0);
});

test("verification failure queues a bounded retry", async () => {
  const a = adapters({
    proof: { verified: false, reason: "tests_failed", evidence: [] },
  });

  const core = new ArchitectCore({ ...a, maxAttempts: 2 });
  const result = await core.run({ id: "job-3", type: "repair", input: {} });

  assert.equal(result.status, STATUS.QUEUED);
  assert.equal(result.attempts, 1);
  assert.equal(result.retry, true);
});

test("verification failure escalates at retry limit", async () => {
  const a = adapters({
    proof: { verified: false, reason: "tests_failed", evidence: [] },
  });

  const core = new ArchitectCore({ ...a, maxAttempts: 1 });
  const result = await core.run({ id: "job-4", type: "repair", input: {} });

  assert.equal(result.status, STATUS.ESCALATED);
  assert.equal(result.attempts, 1);
  assert.equal(result.failure, "tests_failed");
});

test("unexpected adapter errors escalate and are persisted", async () => {
  const a = adapters();
  a.executor.execute = async () => {
    throw new Error("sandbox unavailable");
  };

  const core = new ArchitectCore({ ...a, maxAttempts: 2 });
  const result = await core.run({ id: "job-5", type: "repair", input: {} });

  assert.equal(result.status, STATUS.ESCALATED);
  assert.equal(result.error.message, "sandbox unavailable");
  assert.ok(result.events.some((event) => event.event === "UNHANDLED_FAILURE"));
});

test("constructor rejects unsafe retry configuration", () => {
  const a = adapters();
  assert.throws(
    () => new ArchitectCore({ ...a, maxAttempts: 0 }),
    /maxAttempts/
  );
});

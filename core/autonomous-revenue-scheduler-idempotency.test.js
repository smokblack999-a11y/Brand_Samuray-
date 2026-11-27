"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { executeApprovedPlans } = require("./autonomous-revenue-scheduler");

function fixture() {
  const records = [];
  const runtime = {
    list(tenantId, type) {
      return records.filter(row => row.tenantId === tenantId && row.type === type);
    },
    recordExecution(tenantId, input) {
      const duplicate = records.find(row =>
        row.tenantId === tenantId && row.executionId === input.executionId
      );
      if (duplicate) return { inserted: false, record: duplicate };
      const row = { ...input, tenantId, type: "EXECUTION" };
      records.push(row);
      return { inserted: true, record: row };
    }
  };
  const claims = new Map();
  const claimStore = {
    acquire(tenantId, executionId, metadata) {
      const key = tenantId + ":" + executionId;
      if (claims.has(key)) return { acquired: false, record: claims.get(key) };
      const record = { tenantId, executionId, status: "STARTED", metadata };
      claims.set(key, record);
      return { acquired: true, record };
    },
    complete(tenantId, executionId, status, details) {
      const key = tenantId + ":" + executionId;
      const record = claims.get(key);
      if (!record) throw new Error("claim missing");
      const updated = { ...record, status, details };
      claims.set(key, updated);
      return updated;
    }
  };
  const plan = {
    lead: { email: "lead@example.test" },
    actionPlan: { status: "READY_FOR_EXECUTION", action: "FOLLOW_UP" },
    executionAuthorization: {
      decisionId: "decision-1",
      reservationId: "reservation-1",
      riskSizeMicro: "1000",
      gateDecision: "EXECUTE"
    }
  };
  return { records, runtime, plan, claimStore, claims };
}

test("persists tenant-scoped write-ahead intent before Apollo execution", async () => {
  const { records, runtime, plan, claimStore, claims } = fixture();
  let observedIntentBeforeCall = false;
  const executor = {
    enabled: () => true,
    async executePlan() {
      observedIntentBeforeCall = records.some(row =>
        row.tenantId === "tenant-a" &&
        row.executionId === "apollo:decision-1:reservation-1:intent" &&
        row.status === "STARTED"
      );
      return { executed: true, status: "ENROLLED", contactId: "contact-1" };
    }
  };

  const result = await executeApprovedPlans({ plans: [plan] }, "tenant-a", { executor, runtime, claimStore });

  assert.equal(observedIntentBeforeCall, true);
  assert.equal(result[0].status, "ENROLLED");
  assert.equal(records.length, 2);
  assert.ok(records.every(row => row.tenantId === "tenant-a"));
  assert.equal(records.find(row => row.executionId === "apollo:decision-1:reservation-1").status, "ENROLLED");
  assert.equal(claims.get("tenant-a:apollo:decision-1:reservation-1").status, "ENROLLED");
});

test("does not repeat a provider action when a prior intent already exists", async () => {
  const { runtime, plan, claimStore } = fixture();
  let calls = 0;
  const executor = {
    enabled: () => true,
    async executePlan() { calls += 1; return { executed: true, status: "ENROLLED" }; }
  };

  await executeApprovedPlans({ plans: [plan] }, "tenant-a", { executor, runtime, claimStore });
  const retry = await executeApprovedPlans({ plans: [plan] }, "tenant-a", { executor, runtime, claimStore });

  assert.equal(calls, 1);
  assert.equal(retry[0].status, "SKIPPED");
  assert.equal(retry[0].code, "EXECUTION_CLAIM_EXISTS");
});

test("marks uncertain provider outcomes and blocks automatic retry", async () => {
  const { records, runtime, plan, claimStore } = fixture();
  let calls = 0;
  const executor = {
    enabled: () => true,
    async executePlan() {
      calls += 1;
      throw Object.assign(new Error("connection closed after request"), { code: "ECONNRESET" });
    }
  };

  const first = await executeApprovedPlans({ plans: [plan] }, "tenant-a", { executor, runtime, claimStore });
  const second = await executeApprovedPlans({ plans: [plan] }, "tenant-a", { executor, runtime, claimStore });

  assert.equal(first[0].status, "UNKNOWN");
  assert.equal(second[0].status, "SKIPPED");
  assert.equal(second[0].code, "EXECUTION_CLAIM_EXISTS");
  assert.equal(calls, 1);
  assert.ok(records.some(row => row.executionId.endsWith(":outcome-unknown") && row.status === "UNKNOWN"));
  assert.equal(claimStore.acquire("tenant-a", "apollo:decision-1:reservation-1").record.status, "UNKNOWN");
});

test("rejects an empty tenant identifier before recording or executing", async () => {
  const { records, runtime, plan, claimStore } = fixture();
  let calls = 0;
  const executor = { enabled: () => true, async executePlan() { calls += 1; return {}; } };

  await assert.rejects(
    executeApprovedPlans({ plans: [plan] }, "  ", { executor, runtime }),
    /tenantId is required/
  );
  assert.equal(calls, 0);
  assert.equal(records.length, 0);
});

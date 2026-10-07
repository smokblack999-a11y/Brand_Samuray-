"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const executor = require("./apollo-outreach-executor");

test("Apollo outreach execution is fail-closed by default", () => {
  const oldOutreach = process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED;
  const oldExecution = process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED;
  delete process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED;
  delete process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED;
  assert.equal(executor.enabled(), false);
  if (oldOutreach == null) delete process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED;
  else process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED = oldOutreach;
  if (oldExecution == null) delete process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED;
  else process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED = oldExecution;
});

test("Contact payload excludes undefined fields and enables dedupe", () => {
  const payload = executor.contactPayload({
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    company: "Acme",
    website: "https://acme.example"
  });
  assert.equal(payload.first_name, "Jane");
  assert.equal(payload.email, "jane@example.com");
  assert.equal(payload.run_dedupe, true);
  assert.equal("title" in payload, false);
});

test("Execution rejects a READY plan without gate authorization", async () => {
  const oldOutreach = process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED;
  const oldExecution = process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED;
  process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED = "true";
  process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED = "true";
  await assert.rejects(
    executor.executePlan({
      lead: { email: "person@example.com", firstName: "Jane" },
      actionPlan: { status: "READY_FOR_EXECUTION" }
    }),
    /EXECUTION_AUTHORIZATION_REQUIRED/
  );
  if (oldOutreach == null) delete process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED;
  else process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED = oldOutreach;
  if (oldExecution == null) delete process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED;
  else process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED = oldExecution;
});

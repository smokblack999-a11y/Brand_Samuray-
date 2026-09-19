"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { processRepair, nextDiagnosed } = require("./github-agent-repair-worker");

test("repair worker is disabled by default", async () => {
  delete process.env.GITHUB_AGENT_AUTO_REPAIR;
  const result = await processRepair();
  assert.deepEqual(result, { processed: false, reason: "auto_repair_disabled" });
});

test("repair worker only selects explicitly patch-ready diagnoses", () => {
  const job = nextDiagnosed();
  assert.ok(job === null || (job.state === "diagnosed" && job.safeToPatch === true));
});

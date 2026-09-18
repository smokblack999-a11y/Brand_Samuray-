"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { runOnce } = require("./github-agent-loop");

test("loop diagnoses, repairs only when patch-ready, then verifies", async () => {
  const calls = [];
  const result = await runOnce({
    diagnosis: async () => { calls.push("diagnosis"); return { processed: true, safeToPatch: true }; },
    repair: async () => { calls.push("repair"); return { processed: true, state: "pr_open" }; },
    verify: async () => { calls.push("verify"); return [{ verified: true }]; }
  });
  assert.deepEqual(calls, ["diagnosis", "repair", "verify"]);
  assert.equal(result.repair.state, "pr_open");
  assert.equal(result.verification[0].verified, true);
});

test("loop does not patch an unsafe diagnosis", async () => {
  let repaired = false;
  const result = await runOnce({
    diagnosis: async () => ({ processed: true, safeToPatch: false }),
    repair: async () => { repaired = true; },
    verify: async () => []
  });
  assert.equal(repaired, false);
  assert.equal(result.repair.reason, "repair_not_ready");
});

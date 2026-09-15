"use strict";

const assert = require("node:assert/strict");
const { buildPatchCandidate } = require("./patch-candidate");

test("rejects diagnosis without reproduction and causality", () => {
  const result = buildPatchCandidate({ evidenceOnly: true, category: "test_failure", reproduction: false, causality: false }, ["src/a.js"]);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "REPRODUCTION_AND_CAUSALITY_REQUIRED");
});

test("accepts only bounded known strategy after gates", () => {
  const result = buildPatchCandidate({ evidenceOnly: true, category: "syntax_error", reproduction: true, causality: true }, ["src/a.js", "src/b.js", "src/c.js", "src/d.js"]);
  assert.equal(result.accepted, true);
  assert.equal(result.candidate.strategyId, "syntax-targeted");
  assert.deepEqual(result.candidate.files, ["src/a.js", "src/b.js", "src/c.js"]);
  assert.equal(result.candidate.autonomousWrite, false);
  assert.equal(result.candidate.requiresSandbox, true);
});

test("rejects unknown categories", () => {
  const result = buildPatchCandidate({ evidenceOnly: true, category: "generic", reproduction: true, causality: true }, []);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "NO_BOUNDED_FIX_STRATEGY");
});

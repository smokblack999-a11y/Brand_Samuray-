const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPatchCandidate } = require("../interop/patch-candidate");

const DIFF = [
  "diff --git a/core/example.js b/core/example.js",
  "index 1111111..2222222 100644",
  "--- a/core/example.js",
  "+++ b/core/example.js",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  ""
].join("\n");

test("accepts a bounded evidence-bound candidate without claiming reproduction", () => {
  const result = buildPatchCandidate({ diff: DIFF, evidenceOnly: true, source: "test-candidate" });
  assert.equal(result.accepted, true);
  assert.equal(result.candidate.evidenceOnly, true);
  assert.equal(result.candidate.reproduction, false);
  assert.equal(result.candidate.causality, false);
  assert.equal(result.candidate.requiresSandbox, true);
  assert.deepEqual(result.candidate.files, ["core/example.js"]);
});

test("rejects candidate touching a file outside the declared scope", () => {
  const result = buildPatchCandidate({
    diff: DIFF,
    changedFiles: ["core/other.js"]
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "PATCH_TOUCHES_UNRELATED_FILE");
});

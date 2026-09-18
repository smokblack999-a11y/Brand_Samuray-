const test = require("node:test");
const assert = require("node:assert/strict");
const { validateUnifiedDiff } = require("../interop/patch-candidate");
const { buildPatchProposal } = require("../interop/patch-proposal");

const diff = [
  "diff --git a/core/example.js b/core/example.js",
  "index 1111111..2222222 100644",
  "--- a/core/example.js",
  "+++ b/core/example.js",
  "@@ -1 +1 @@",
  "-old",
  "+new"
].join("\n");

test("validates bounded unified diffs", () => {
  const result = validateUnifiedDiff(diff);
  assert.deepEqual(result.files, ["core/example.js"]);
});

test("rejects traversal paths", () => {
  assert.throws(() => validateUnifiedDiff(
    diff.replace("a/core/example.js b/core/example.js", "a/../x b/../x")
  ), /UNSAFE_PATH/);
});

test("patch proposal requires evidence and causal reproduction", () => {
  assert.equal(buildPatchProposal({ diff }).accepted, false);
  const result = buildPatchProposal({ diff, evidenceOnly:true, reproduction:true, causality:true });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.proposal.files, ["core/example.js"]);
});

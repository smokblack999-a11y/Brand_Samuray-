"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateUnifiedDiff } = require("./patch-candidate");

test("validates a bounded unified diff", () => {
  const diff = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1 +1 @@",
    "-old",
    "+new"
  ].join("\n");
  assert.deepEqual(validateUnifiedDiff(diff).files, ["src/a.js"]);
});

test("rejects path traversal", () => {
  const diff = [
    "diff --git a/../secret b/../secret",
    "--- a/../secret",
    "+++ b/../secret"
  ].join("\n");
  assert.throws(() => validateUnifiedDiff(diff), /INVALID_PATCH_PATH/);
});

test("rejects patch without files", () => {
  assert.throws(() => validateUnifiedDiff("diff --git a/x b/x\n--- a/x\n"), /PATCH_FILES_REQUIRED/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { commandParts, validateCommand } = require("./sandbox");
const { validateUnifiedDiff } = require("./patch-candidate");

test("sandbox accepts bounded node/npm commands", () => {
  assert.deepEqual(commandParts("npm test"), ["npm", "test"]);
  assert.deepEqual(validateCommand(["node", "--check", "core/server.js"]), ["node", "--check", "core/server.js"]);
});

test("sandbox rejects shell and traversal commands", () => {
  assert.throws(() => validateCommand("sh -c npm test"), /not allowed/);
  assert.throws(() => validateCommand("npm test ../outside"), /unsafe path/);
});

test("patch contract rejects workflow and secret paths", () => {
  const workflowPatch = "diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n--- a/.github/workflows/x.yml\n+++ b/.github/workflows/x.yml\n@@ -1 +1 @@\n-a\n+b\n";
  const secretPatch = "diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-a\n+b\n";
  assert.throws(() => validateUnifiedDiff(workflowPatch), /FORBIDDEN_PATCH_PATH/);
  assert.throws(() => validateUnifiedDiff(secretPatch), /FORBIDDEN_PATCH_PATH/);
});

test("patch contract accepts a small source patch", () => {
  const patch = "diff --git a/example.js b/example.js\n--- a/example.js\n+++ b/example.js\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n";
  const result = validateUnifiedDiff(patch);
  assert.deepEqual(result.files, ["example.js"]);
  assert.equal(result.version, 1);
});

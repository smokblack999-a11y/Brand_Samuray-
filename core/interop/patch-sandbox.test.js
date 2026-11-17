"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateSandboxFiles,
  createSandboxReceipt,
  MAX_SANDBOX_FILES
} = require("./patch-sandbox");

test("allows JavaScript files within Core", () => {
  assert.deepEqual(
    validateSandboxFiles(["core/interop/patch-sandbox.js", "core/server.js"]),
    ["core/interop/patch-sandbox.js", "core/server.js"]
  );
});

test("rejects files outside Core and non-JavaScript files", () => {
  assert.throws(() => validateSandboxFiles([".github/workflows/test.yml"]), {
    message: "SANDBOX_FILE_TYPE_BLOCKED"
  });
  assert.throws(() => validateSandboxFiles(["core/package.json"]), {
    message: "SANDBOX_FILE_TYPE_BLOCKED"
  });
});

test("rejects node_modules, data and sensitive paths", () => {
  assert.throws(() => validateSandboxFiles(["core/node_modules/payload.js"]), {
    message: "SANDBOX_SENSITIVE_PATH_BLOCKED"
  });
  assert.throws(() => validateSandboxFiles(["core/data/payload.js"]), {
    message: "SANDBOX_SENSITIVE_PATH_BLOCKED"
  });
  assert.throws(() => validateSandboxFiles(["core/.env.js"]), {
    message: "SANDBOX_SENSITIVE_PATH_BLOCKED"
  });
});

test("rejects traversal and backslash paths", () => {
  assert.throws(() => validateSandboxFiles(["core/../outside.js"]), {
    message: "SANDBOX_PATH_BLOCKED"
  });
  assert.throws(() => validateSandboxFiles(["core\\outside.js"]), {
    message: "SANDBOX_PATH_BLOCKED"
  });
});

test("enforces a file-count limit", () => {
  const files = Array.from({length: MAX_SANDBOX_FILES + 1}, (_, i) => `core/file-${i}.js`);
  assert.throws(() => validateSandboxFiles(files), {
    message: "SANDBOX_TOO_MANY_FILES"
  });
});

test("creates a receipt bound to exact base, head, patch and test log", () => {
  const receipt = createSandboxReceipt({
    repository: "owner/repo",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    patch: "diff --git a/core/a.js b/core/a.js",
    testLog: "tests passed",
    runId: 12345,
    conclusion: "success"
  });
  assert.equal(receipt.schema, "samurai-nexus-sandbox-receipt/v1");
  assert.equal(receipt.conclusion, "success");
  assert.equal(receipt.networkDuringTests, "none");
  assert.equal(receipt.secretsAvailableToTestContainer, false);
  assert.match(receipt.patchSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.testLogSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
});

test("does not create a receipt without valid provenance fields", () => {
  assert.throws(() => createSandboxReceipt({
    repository: "owner/repo",
    baseSha: "not-a-sha",
    headSha: "b".repeat(40),
    patch: "diff",
    testLog: "",
    runId: 1,
    conclusion: "success"
  }), {message: "SANDBOX_RECEIPT_INPUT_INVALID"});
});

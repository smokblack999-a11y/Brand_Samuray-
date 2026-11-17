"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateUnifiedDiff, MAX_PATCH_FILES } = require("./patch-candidate");

function diffFor(path = "core/sample.js") {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-const before = 1;",
    "+const after = 2;",
    ""
  ].join("\n");
}

test("accepts a normal single-file unified diff", () => {
  const result = validateUnifiedDiff(diffFor());
  assert.deepEqual(result.files, ["core/sample.js"]);
});

test("accepts a new file diff", () => {
  const diff = [
    "diff --git a/core/new.js b/core/new.js",
    "--- /dev/null",
    "+++ b/core/new.js",
    "@@ -0,0 +1 @@",
    "+module.exports = true;",
    ""
  ].join("\n");
  assert.deepEqual(validateUnifiedDiff(diff).files, ["core/new.js"]);
});

test("accepts a deleted file diff", () => {
  const diff = [
    "diff --git a/core/old.js b/core/old.js",
    "--- a/core/old.js",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-module.exports = true;",
    ""
  ].join("\n");
  assert.deepEqual(validateUnifiedDiff(diff).files, ["core/old.js"]);
});

test("rejects absolute paths", () => {
  const diff = "--- /etc/passwd\n+++ b/etc/passwd\n@@ -1 +1 @@\n-a\n+b\n";
  assert.throws(() => validateUnifiedDiff(diff), { message: "INVALID_PATCH_PATH" });
});

test("rejects Windows drive paths", () => {
  const diff = "--- a/C:/Windows/system.ini\n+++ b/C:/Windows/system.ini\n@@ -1 +1 @@\n-a\n+b\n";
  assert.throws(() => validateUnifiedDiff(diff), { message: "INVALID_PATCH_PATH" });
});

test("rejects parent traversal", () => {
  assert.throws(() => validateUnifiedDiff(diffFor("../outside.js")), { message: "INVALID_PATCH_PATH" });
});

test("rejects .git metadata paths", () => {
  assert.throws(() => validateUnifiedDiff(diffFor(".git/config")), { message: "INVALID_PATCH_PATH" });
});

test("rejects backslash paths", () => {
  assert.throws(() => validateUnifiedDiff(diffFor("core\\\\escape.js")), { message: "INVALID_PATCH_PATH" });
});

test("rejects mismatched old and new paths", () => {
  const diff = [
    "diff --git a/core/one.js b/core/two.js",
    "--- a/core/one.js",
    "+++ b/core/two.js",
    "@@ -1 +1 @@",
    "-a",
    "+b"
  ].join("\n");
  assert.throws(() => validateUnifiedDiff(diff), { message: "PATCH_PATH_MISMATCH" });
});

test("rejects symlink changes", () => {
  const diff = [
    "diff --git a/core/link b/core/link",
    "new file mode 120000",
    "--- /dev/null",
    "+++ b/core/link",
    "@@ -0,0 +1 @@",
    "+../../outside"
  ].join("\n");
  assert.throws(() => validateUnifiedDiff(diff), { message: "SYMLINK_PATCH_NOT_SUPPORTED" });
});

test("rejects binary patches", () => {
  assert.throws(() => validateUnifiedDiff("GIT binary patch\n"), { message: "BINARY_PATCH_NOT_SUPPORTED" });
});

test("rejects too many changed files", () => {
  const parts = [];
  for (let i = 0; i < MAX_PATCH_FILES + 1; i++) parts.push(diffFor(`core/file-${i}.js`));
  assert.throws(() => validateUnifiedDiff(parts.join("\n")), { message: "PATCH_TOO_MANY_FILES" });
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extractDiff, buildPrompt } = require("./openai-patch-proposer");

test("extracts a unified diff from model output", () => {
  const diff = extractDiff("Here is the fix:\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-fail\n+pass\n");
  assert.equal(diff, "--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-fail\n+pass\n");
});

test("prompt explicitly keeps the model proposal-only", () => {
  const prompt = buildPrompt({
    evidence: { evidenceOnly: true, category: "syntax_error" },
    changedFiles: ["test.js"],
    source: "const x = ;"
  });
  assert.match(prompt, /proposal only/i);
  assert.match(prompt, /isolated workspace/i);
  assert.match(prompt, /test\.js/);
});

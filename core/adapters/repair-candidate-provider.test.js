"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRepairCandidateProvider } = require("./repair-candidate-provider");

test("rejects empty candidates", async () => {
  const provider = createRepairCandidateProvider({ generate: async () => ({}) });
  assert.equal(await provider({ mission: {}, plan: {} }), null);
});

test("normalizes bounded candidate", async () => {
  const provider = createRepairCandidateProvider({
    generate: async () => ({ changed_files: ["a.js"], changed_lines: 3 })
  });
  assert.deepEqual(await provider({ mission: {}, plan: {} }), { changed_files: ["a.js"], changed_lines: 3 });
});

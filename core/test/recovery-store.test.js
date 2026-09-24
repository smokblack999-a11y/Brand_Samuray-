"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("persistent recovery store rejects skipped states", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x10thinc-store-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    delete require.cache[require.resolve("../recovery-store")];
    const store = require("../recovery-store");
    const { STATES } = require("../x10thinc/recovery-state");
    const created = store.enqueue({
      repository: "smokblack999-a11y/Brand_Samuray-",
      runId: "test-run",
      sha: "abc"
    });
    assert.equal(created.job.state, STATES.QUEUED);
    assert.throws(
      () => store.update(created.job.id, { state: STATES.SANDBOXED }),
      /INVALID_STATE_TRANSITION/
    );
    assert.equal(store.find(created.job.id).state, STATES.QUEUED);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    delete require.cache[require.resolve("../recovery-store")];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistent recovery store permits only declared transitions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x10thinc-store-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    delete require.cache[require.resolve("../recovery-store")];
    const store = require("../recovery-store");
    const { STATES } = require("../x10thinc/recovery-state");
    const created = store.enqueue({
      repository: "smokblack999-a11y/Brand_Samuray-",
      runId: "test-run-2",
      sha: "abc"
    });
    const diagnosing = store.update(created.job.id, { state: STATES.DIAGNOSING, status: STATES.DIAGNOSING });
    assert.equal(diagnosing.state, STATES.DIAGNOSING);
    const proposed = store.update(created.job.id, { state: STATES.PATCH_PROPOSED, status: STATES.PATCH_PROPOSED });
    assert.equal(proposed.state, STATES.PATCH_PROPOSED);
    const sandboxed = store.update(created.job.id, { state: STATES.SANDBOXED, status: "sandbox_pending" });
    assert.equal(sandboxed.state, STATES.SANDBOXED);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    delete require.cache[require.resolve("../recovery-store")];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

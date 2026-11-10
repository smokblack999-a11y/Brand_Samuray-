"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const gate = require("../agent-control-runner-gate");

test("unverified runner evidence is rejected with 503", () => {
  let statusCode;
  let payload;
  const response = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return value; }
  };
  gate.rejectUnverifiedEvidence({ requestId: "test-request" }, response);
  assert.equal(statusCode, 503);
  assert.equal(payload.error.code, "TRUSTED_RUNNER_ADAPTER_NOT_CONFIGURED");
  assert.equal(payload.error.requestId, "test-request");
});

test("all public NEXUS evidence transitions use the fail-closed handler", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  for (const stage of ["sandbox", "ci", "proof"]) {
    const route = new RegExp(
      'app\\.post\\("\\/api\\/agent-control\\/jobs\\/:id\\/' + stage +
      '", requireApiKey, runnerEvidenceGate\\.rejectUnverifiedEvidence\\)'
    );
    assert.match(source, route, stage + " route must fail closed");
  }
});

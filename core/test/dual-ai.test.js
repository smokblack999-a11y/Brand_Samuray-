"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-dual-"));

const engine = require("../dual-ai/engine");

test("critic loop reaches COMPLETE after a revision and final gate", async () => {
  const created = engine.createSession({
    task: "Build a robust API module.",
    mode: "critic",
    providerA: "mock",
    providerB: "mock",
    modelA: "mock-a",
    modelB: "mock-b",
    maxCycles: 2
  });

  let session = created;
  for (let i = 0; i < 4; i += 1) session = await engine.runTurn(created.id);

  assert.equal(session.status, "COMPLETE");
  assert.equal(session.phase, "COMPLETE");
  assert.match(session.finalAnswer, /Revised candidate/);
  assert.equal(session.turns.length, 4);
  assert.equal(session.lastGate.pass, true);
});

test("Kill Critic gate is fail-closed on low confidence and critical issues", () => {
  const gate = engine.parseGate("A sufficiently long candidate response for testing.", {
    decision: "PASS",
    confidence: 0.30,
    issues: [{ severity: "critical", claim: "x", evidence: "y", fix: "z" }]
  });
  assert.equal(gate.pass, false);
  assert.ok(gate.reasons.includes("confidence_below_threshold"));
  assert.ok(gate.reasons.includes("critical_issues_present"));
});

test("session export contains both audit metadata and turns", async () => {
  const created = engine.createSession({
    task: "Export this dialogue.",
    mode: "critic",
    providerA: "mock",
    providerB: "mock",
    modelA: "mock-a",
    modelB: "mock-b"
  });
  await engine.runTurn(created.id);
  const artifact = engine.sessionExport(created.id, "txt");
  assert.match(artifact.filename, /^dual-ai-.*\.txt$/);
  assert.match(artifact.content, /SAMURAI AI DUAL/);
  assert.match(artifact.content, /TURN 1/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-dual-"));
process.env.DATA_DIR = tmp;
process.env.DUAL_AI_MAX_ROUNDS = "3";
process.env.EVIDENCE_SIGNING_KEY = "samurai-test-evidence-signing-key-32-bytes";

const engine = require("./dual-ai/engine");
const critic = require("./dual-ai/critic");

test("dual config exposes providers and strict quality gate", () => {
  const cfg = engine.config();
  assert.equal(cfg.maxRounds, 3);
  assert.equal(cfg.qualityGate.minimumScore, 0.85);
  assert.deepEqual(cfg.providers.map(x => x.provider), ["openai", "anthropic", "ollama"]);
});

test("session lifecycle is serializable and rejects unsupported providers", () => {
  const session = engine.create({
    task: "Explain a SaaS metric without inventing facts.",
    a: { provider: "ollama", model: "test" },
    b: { provider: "ollama", model: "test" }
  });
  assert.equal(session.status, "RUNNING");
  assert.equal(session.phase, "A_INITIAL");
  assert.equal(engine.get(session.id).id, session.id);
  assert.throws(
    () => engine.create({ task: "A sufficiently long test task", a: { provider: "fake" } }),
    error => error.code === "UNSUPPORTED_PROVIDER"
  );
  const stopped = engine.stop(session.id);
  assert.equal(stopped.status, "STOPPED");
  assert.equal(stopped.phase, "STOPPED");
});

test("kill critic blocks empty candidate deterministically", async () => {
  const verdict = await critic.review({
    task: "test",
    answer: "",
    provider: "ollama",
    model: "unused"
  });
  assert.equal(verdict.verdict, "FAIL");
  assert.ok(verdict.issues.includes("empty_answer"));
});

test("Kill Critic fails closed when any quality score is below threshold", () => {
  const verdict = critic.parseVerdict(JSON.stringify({
    verdict: "PASS",
    confidence: 0.99,
    requirement_coverage: 0.99,
    factuality: 0.99,
    reasoning_quality: 0.84,
    safety: 0.99,
    issues: [],
    required_changes: [],
    evidence_gaps: []
  }));
  assert.equal(verdict.verdict, "FAIL");
});

test("Kill Critic accepts only a fully clean high-confidence verdict", () => {
  const verdict = critic.parseVerdict(JSON.stringify({
    verdict: "PASS",
    confidence: 0.95,
    requirement_coverage: 0.96,
    factuality: 0.95,
    reasoning_quality: 0.94,
    safety: 0.99,
    issues: [],
    required_changes: [],
    evidence_gaps: []
  }));
  assert.equal(verdict.verdict, "PASS");
});

test("Kill Critic fails closed on malformed JSON and incomplete verdicts", () => {
  const malformed = critic.parseVerdict("not-json");
  assert.equal(malformed.verdict, "FAIL");
  assert.ok(malformed.issues.includes("invalid_critic_output"));

  const incomplete = critic.parseVerdict(JSON.stringify({
    verdict: "PASS",
    confidence: 1,
    requirement_coverage: 1,
    factuality: 1,
    reasoning_quality: 1,
    safety: 1
  }));
  assert.equal(incomplete.verdict, "FAIL");
  assert.ok(incomplete.issues.includes("invalid_critic_output"));
});


test("evidence verifier requires server proof for code and current-fact claims", () => {
  const verifier = require("./dual-ai/evidence-verifier");
  const code = verifier.verifyEvidence({ task: "Build and test the Android app", answer: "Implementation is ready." });
  assert.equal(code.status, "REQUIRED");
  assert.deepEqual(code.missing, ["tests", "build"]);
  const current = verifier.verifyEvidence({ task: "Find the latest market price", answer: "The current price is ..." });
  assert.equal(current.status, "REQUIRED");
  assert.ok(current.missing.includes("sources"));
});

test("evidence verifier rejects unsigned and malformed proof records", () => {
  const verifier = require("./dual-ai/evidence-verifier");
  const fake = { kind: "tests", status: "passed", origin: "server", digest: "a".repeat(64), at: new Date().toISOString() };
  assert.equal(verifier.verifyEvidence({ task: "Run tests", answer: "All tests passed.", evidence: [fake] }).verified, false);
  const malformed = { ...fake, digest: "not-a-hash" };
  assert.equal(verifier.validServerEvidence(malformed), false);
  const forged = { ...fake, digest: "a".repeat(64) };
  assert.equal(verifier.validServerEvidence(forged), false);
});

test("evidence verifier accepts only HMAC-authenticated server proof records", () => {
  const verifier = require("./dual-ai/evidence-verifier");
  const at = new Date().toISOString();
  const evidence = ["tests", "build"].map(kind => verifier.createEvidenceRecord({
    kind, digest: require("crypto").createHash("sha256").update(kind + at).digest("hex"), at
  }));
  const result = verifier.verifyEvidence({ task: "Build and test the Android app", answer: "Candidate implementation.", evidence });
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.verified, true);
});


test("evidence policy recognizes Russian engineering and current-fact requests", () => {
  const verifier = require("./dual-ai/evidence-verifier");
  const result = verifier.verifyEvidence({ task: "Собери и протестируй приложение", answer: "Проверь актуальную цену." });
  assert.deepEqual(result.required, ["tests", "build", "sources"]);
});

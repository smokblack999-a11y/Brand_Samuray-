"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-dual-"));
process.env.DATA_DIR = tmp;
process.env.DUAL_AI_MAX_ROUNDS = "3";

const engine = require("./dual-ai/engine");
const critic = require("./dual-ai/critic");

test("dual config is bounded and exposes providers", () => {
  const cfg = engine.config();
  assert.equal(cfg.maxRounds, 3);
  assert.deepEqual(cfg.providers.map(x => x.provider), ["openai", "anthropic", "ollama"]);
});

test("session lifecycle is serializable", () => {
  const session = engine.create({
    task: "Explain a SaaS metric without inventing facts.",
    a: { provider: "ollama", model: "test" },
    b: { provider: "ollama", model: "test" }
  });
  assert.equal(session.status, "RUNNING");
  assert.equal(session.phase, "A_INITIAL");
  assert.equal(engine.get(session.id).id, session.id);
  const stopped = engine.stop(session.id);
  assert.equal(stopped.status, "STOPPED");
  assert.equal(stopped.phase, "STOPPED");
});

test("kill critic blocks empty candidate deterministically", () => {
  return critic.review({
    task: "test",
    answer: "",
    provider: "ollama",
    model: "unused"
  }).then(verdict => {
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(verdict.issues.includes("empty_answer"));
  });
});

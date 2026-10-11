"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SamuraiCore } = require("./index");
const { SamuraiEventBus } = require("./event-bus");
const { ModuleRegistry } = require("./module-registry");

test("event bus isolates handler failures", async () => {
  const bus = new SamuraiEventBus();
  const seen = [];

  bus.on("x", async () => seen.push("first"));
  bus.on("x", async () => { throw new Error("boom"); });
  bus.on("x", async () => seen.push("third"));

  const result = await bus.publish("x", { value: 42 });

  assert.deepEqual(seen, ["first", "third"]);
  assert.equal(result.handlers, 3);
  assert.equal(result.failures, 1);
});

test("module registry starts in order and stops in reverse order", async () => {
  const registry = new ModuleRegistry();
  const calls = [];

  registry.register({
    name: "camera",
    start: async () => calls.push("camera:start"),
    stop: async () => calls.push("camera:stop")
  });
  registry.register({
    name: "telegram",
    start: async () => calls.push("telegram:start"),
    stop: async () => calls.push("telegram:stop")
  });

  await registry.startAll({});
  await registry.stopAll({});

  assert.deepEqual(calls, [
    "camera:start",
    "telegram:start",
    "telegram:stop",
    "camera:stop"
  ]);
});

test("core lifecycle, memory and audit are deterministic", async () => {
  const core = new SamuraiCore({ version: "test" });
  let started = false;

  core.modules.register({
    name: "probe",
    start: async () => { started = true; },
    health: () => ({ ok: started })
  });

  const health = await core.start();

  assert.equal(health.ok, true);
  assert.equal(health.state, "RUNNING");
  assert.equal(started, true);

  core.remember("answer", 42);
  assert.equal(core.recall("answer"), 42);
  assert.equal(core.recall("missing"), undefined);
  assert.ok(core.audit.length >= 1);

  await core.stop();
  assert.equal(core.state, "STOPPED");
});

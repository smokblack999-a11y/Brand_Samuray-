"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { X10Think, reducer } = require("./x10think");

test("reducer applies set and push deltas deterministically", () => {
  const state = reducer({ meta: {}, messages: [] }, [
    { type: "set", path: "meta.round", value: 1 },
    { type: "push", path: "messages", value: { role: "solver", text: "ok" } }
  ]);

  assert.deepEqual(state, {
    meta: { round: 1 },
    messages: [{ role: "solver", text: "ok" }]
  });
});

test("checkpoint stores an immutable snapshot", () => {
  const engine = new X10Think({ count: 1 });
  engine.checkpoint("before");
  engine.apply([{ type: "set", path: "count", value: 2 }]);

  assert.equal(engine.lastCheckpoint().state.count, 1);
  assert.equal(engine.state.count, 2);
});

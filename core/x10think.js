"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reducer(state, deltas) {
  const next = clone(state || {});
  for (const delta of Array.isArray(deltas) ? deltas : []) {
    if (!delta || typeof delta !== "object") continue;
    if (delta.type === "set" && typeof delta.path === "string") {
      const keys = delta.path.split(".").filter(Boolean);
      if (!keys.length) continue;
      let cursor = next;
      for (let i = 0; i < keys.length - 1; i += 1) {
        if (!cursor[keys[i]] || typeof cursor[keys[i]] !== "object") cursor[keys[i]] = {};
        cursor = cursor[keys[i]];
      }
      cursor[keys[keys.length - 1]] = clone(delta.value);
    }
    if (delta.type === "push" && typeof delta.path === "string") {
      const keys = delta.path.split(".").filter(Boolean);
      if (!keys.length) continue;
      let cursor = next;
      for (let i = 0; i < keys.length - 1; i += 1) {
        if (!cursor[keys[i]] || typeof cursor[keys[i]] !== "object") cursor[keys[i]] = {};
        cursor = cursor[keys[i]];
      }
      const key = keys[keys.length - 1];
      if (!Array.isArray(cursor[key])) cursor[key] = [];
      cursor[key].push(clone(delta.value));
    }
  }
  return next;
}

class X10Think {
  constructor(initial = {}) {
    this.state = clone(initial);
    this.checkpoints = [];
  }

  apply(deltas) {
    this.state = reducer(this.state, deltas);
    return this.state;
  }

  checkpoint(label = "checkpoint") {
    const snapshot = {
      label,
      state: clone(this.state),
      createdAt: new Date().toISOString()
    };
    this.checkpoints.push(snapshot);
    return snapshot;
  }

  lastCheckpoint() {
    return this.checkpoints[this.checkpoints.length - 1] || null;
  }
}

module.exports = { X10Think, reducer };

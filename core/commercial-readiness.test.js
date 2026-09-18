"use strict";

const assert = require("assert");
const { GATES, commercialReadiness } = require("./commercial-readiness");

test("readiness has exactly 15 evidence gates", () => {
  assert.equal(GATES.length, 15);
  assert.equal(new Set(GATES.map(([id]) => id)).size, 15);
});

test("missing commercial proof cannot be disguised as an 86 percent sale probability", () => {
  const result = commercialReadiness({ ci: true, tests: true, android: true, api: true, telegram: true, security: true, safe_defaults: true, deduplication: true, rate_limit: true, observability: true, persistence: true, ai_fallback: true });
  assert.ok(result.score < 86);
  assert.equal(result.target, 86);
  assert.equal(result.targetReached, false);
  assert.match(result.confidence, /not a sale-probability guarantee/);
  assert.ok(result.blockers.includes("revenue"));
  assert.ok(result.blockers.includes("pilot_gate"));
});

test("all objective gates reach the 86 target without claiming certainty", () => {
  const evidence = Object.fromEntries(GATES.map(([id]) => [id, true]));
  const result = commercialReadiness(evidence);
  assert.equal(result.score, 100);
  assert.equal(result.targetReached, true);
  assert.equal(result.blockers.length, 0);
});

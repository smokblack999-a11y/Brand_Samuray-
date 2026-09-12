"use strict";

const GATES = Object.freeze([
  ["ci", 10, "Core CI and Android CI are green"],
  ["tests", 8, "Automated regression tests are present"],
  ["android", 7, "A distributable Android artifact can be built"],
  ["api", 7, "Lead analysis API is available"],
  ["telegram", 7, "Telegram Business webhook path is implemented"],
  ["security", 9, "Authentication, webhook secrets and secret scanning exist"],
  ["safe_defaults", 7, "Auto-reply is disabled by default"],
  ["deduplication", 5, "Webhook events are deduplicated"],
  ["rate_limit", 5, "Lead analysis is rate limited"],
  ["observability", 6, "Health, readiness and request IDs exist"],
  ["persistence", 6, "Lead state is persisted"],
  ["ai_fallback", 4, "The core remains useful without an AI key"],
  ["pilot_gate", 8, "A real pilot has produced measurable evidence"],
  ["revenue", 6, "A real customer has paid"],
  ["repeatability", 5, "The offer can be deployed and sold repeatedly"]
]);

function bool(value) {
  return value === true;
}

function commercialReadiness(evidence = {}) {
  const gates = GATES.map(([id, weight, description]) => ({
    id,
    weight,
    description,
    passed: bool(evidence[id])
  }));
  const totalWeight = gates.reduce((sum, gate) => sum + gate.weight, 0);
  const earned = gates.reduce((sum, gate) => sum + (gate.passed ? gate.weight : 0), 0);
  const score = Math.round((earned / totalWeight) * 100);
  const blockers = gates.filter((gate) => !gate.passed).sort((a, b) => b.weight - a.weight);
  const nextActions = blockers.slice(0, 5).map((gate) => gate.description);

  return {
    score,
    target: 86,
    targetReached: score >= 86,
    confidence: "evidence-based, not a sale-probability guarantee",
    passed: gates.filter((gate) => gate.passed).map((gate) => gate.id),
    blockers: blockers.map((gate) => gate.id),
    nextActions,
    gates
  };
}

module.exports = { GATES, commercialReadiness };

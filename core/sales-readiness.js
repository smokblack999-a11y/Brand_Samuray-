"use strict";

/**
 * Evidence-based commercial readiness. This is NOT a guaranteed probability of sale.
 * It turns observable product evidence into a conservative readiness score and
 * explicitly reports the missing proof required to increase buyer confidence.
 */
const CHECKS = [
  ["api", "Protected API and stable error contract", 7],
  ["webhook", "Authenticated Telegram webhook with deduplication", 7],
  ["lead_scoring", "Deterministic lead scoring with hot/warm/cold intent", 6],
  ["ai_reply", "AI reply path with safe disabled-by-default auto-reply", 7],
  ["persistence", "Persistent lead storage and retry-safe event handling", 6],
  ["observability", "Request IDs, health/readiness and funnel metrics", 7],
  ["security", "Secret scanning and production configuration gates", 7],
  ["tests", "Automated API, auth and webhook tests", 8],
  ["android_ci", "Reproducible Android CI build", 6],
  ["artifact", "Verified non-empty Android APK artifact", 5],
  ["docs", "Clear deployment and product documentation", 5],
  ["demo", "Repeatable buyer-facing demo", 8],
  ["pilot", "At least one real business pilot", 10],
  ["roi", "Measured business outcome / conversion evidence", 11],
];

function buildReadiness(evidence = {}) {
  const missing = [];
  let earned = 0;
  let available = 0;

  for (const [key, label, weight] of CHECKS) {
    available += weight;
    if (evidence[key] === true) earned += weight;
    else missing.push({ key, label, weight });
  }

  const score = Math.round((earned / available) * 100);
  const proofCount = CHECKS.length - missing.length;
  const evidenceQuality = Math.round((proofCount / CHECKS.length) * 100);
  const uncertainty = Math.max(8, Math.round((missing.reduce((sum, x) => sum + x.weight, 0) / available) * 100));

  return {
    score,
    band: score >= 86 ? "sale-ready" : score >= 72 ? "buyer-ready" : score >= 55 ? "pilot-ready" : "prototype",
    confidence: Math.max(0, 100 - uncertainty),
    uncertainty,
    proof: { passed: proofCount, total: CHECKS.length, quality: evidenceQuality },
    missing,
    interpretation: "Readiness is evidence-based; it is not a guaranteed probability of closing a sale."
  };
}

module.exports = { CHECKS, buildReadiness };

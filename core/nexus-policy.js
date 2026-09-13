"use strict";

const { evaluateGate } = require("./proof-engine");

const PRIVILEGED_PATTERNS = [
  /(^|\/)(\.github\/workflows|terraform|k8s|helm)(\/|$)/i,
  /(auth|oauth|permission|secret|token|credential|payment|billing)/i,
  /(dockerfile|compose|iam|firewall|production|deploy)/i
];

function classifyRisk({ changedFiles = [], labels = [], requestedRisk } = {}) {
  if (requestedRisk) return String(requestedRisk).toUpperCase();
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const privileged = files.some((file) => PRIVILEGED_PATTERNS.some((pattern) => pattern.test(String(file))));
  if (privileged) return "CRITICAL";
  if (files.length >= 20 || labels.some((x) => /security|infra|production/i.test(String(x)))) return "HIGH";
  if (files.length >= 6) return "MEDIUM";
  return "LOW";
}

function enforcePolicy(input = {}) {
  const risk = classifyRisk(input);
  const gate = evaluateGate({ ...input, risk });
  return {
    ...gate,
    risk,
    privileged: risk === "CRITICAL",
    policy: risk === "CRITICAL" ? "HUMAN_REQUIRED" : "STANDARD"
  };
}

module.exports = { classifyRisk, enforcePolicy };

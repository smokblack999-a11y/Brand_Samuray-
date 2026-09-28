"use strict";

/**
 * Kill Critic v3 — Intent/Diff Consistency Firewall.
 *
 * Deterministic policy layer: compares declared task intent with the actual
 * changed paths and sensitive capabilities. It does not execute code and
 * never grants merge authority.
 */

const SENSITIVE_PATHS = Object.freeze([
  { pattern: /(^|\/)auth(\/|$)/i, capability: "AUTH", risk: "critical" },
  { pattern: /(^|\/)(crypto|cryptography)(\/|$)/i, capability: "CRYPTO", risk: "critical" },
  { pattern: /(^|\/)(tls|ssl)(\/|$)/i, capability: "TLS", risk: "critical" },
  { pattern: /(^|\/)(acl|iam|rbac|permissions?)(\/|$)/i, capability: "ACCESS_CONTROL", risk: "critical" },
  { pattern: /(^|\/)(policy|policies)(\/|$)/i, capability: "POLICY", risk: "high" },
  { pattern: /(^|\/)\.github\/workflows(\/|$)/i, capability: "CI_WORKFLOW", risk: "critical" },
  { pattern: /(^|\/)(Dockerfile|docker-compose[^/]*|compose\.ya?ml)$/i, capability: "CONTAINER", risk: "high" },
  { pattern: /(^|\/)(terraform|\.terraform)(\/|$)|\.tf$/i, capability: "INFRASTRUCTURE", risk: "high" },
  { pattern: /(^|\/)(mcp|agent|agents|skills)(\/|$)/i, capability: "AGENT_CONTROL", risk: "high" }
]);

const INTENT_ALIASES = Object.freeze({
  auth: ["auth", "authentication", "login", "token", "session", "oauth"],
  crypto: ["crypto", "cryptography", "encryption", "signature"],
  tls: ["tls", "ssl", "certificate", "https"],
  test: ["test", "tests", "testing", "spec", "flaky"],
  dependency: ["dependency", "dependencies", "package", "npm", "upgrade"],
  workflow: ["workflow", "github actions", "ci", "pipeline"],
  docker: ["docker", "container", "image"],
  infra: ["terraform", "kubernetes", "infrastructure", "deployment"],
  agent: ["agent", "mcp", "skill", "tool"]
});

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(v => String(v || "").trim())
    .filter(Boolean))];
}

function tokenize(text) {
  return new Set(String(text || "").toLowerCase().split(/[^a-z0-9_.-]+/).filter(t => t.length > 1));
}

function classifyPaths(paths) {
  return normalizeList(paths).map(path => {
    const matches = SENSITIVE_PATHS.filter(rule => rule.pattern.test(path));
    return {
      path,
      capabilities: matches.map(m => m.capability),
      risks: matches.map(m => m.risk),
      sensitive: matches.length > 0
    };
  });
}

function expectedCapabilities(intent) {
  const tokens = tokenize(intent);
  const capabilities = new Set();
  for (const [capability, aliases] of Object.entries(INTENT_ALIASES)) {
    if (aliases.some(alias => tokens.has(alias) || String(intent).toLowerCase().includes(alias))) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}

function assessIntent({ intent = "", changedFiles = [], allowedPaths = [] } = {}) {
  const files = classifyPaths(changedFiles);
  const expected = expectedCapabilities(intent);
  const actual = new Set(files.flatMap(f => f.capabilities.map(c => c.toLowerCase())));
  const allowed = new Set(normalizeList(allowedPaths));

  const unexpectedSensitive = files.filter(file =>
    file.sensitive && !file.capabilities.some(cap => expected.has(cap.toLowerCase()))
  );

  const outOfScope = allowed.size
    ? normalizeList(changedFiles).filter(file => ![...allowed].some(prefix => file === prefix || file.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")))
    : [];

  const declared = [...expected];
  const actualCapabilities = [...new Set(files.flatMap(f => f.capabilities))];
  const scopeMatch = actualCapabilities.length === 0
    ? 1
    : actualCapabilities.filter(c => expected.has(c.toLowerCase())).length / actualCapabilities.length;

  const reasons = [];
  if (!String(intent).trim()) reasons.push("INTENT_REQUIRED");
  if (unexpectedSensitive.length) reasons.push("UNEXPECTED_SENSITIVE_CHANGE");
  if (outOfScope.length) reasons.push("OUT_OF_SCOPE_PATH");
  if (scopeMatch < 0.5 && actualCapabilities.length) reasons.push("LOW_INTENT_ALIGNMENT");

  let decision = "ALLOW";
  if (reasons.includes("INTENT_REQUIRED")) decision = "HUMAN_REVIEW";
  else if (unexpectedSensitive.length || outOfScope.length) decision = "BLOCK";
  else if (reasons.includes("LOW_INTENT_ALIGNMENT")) decision = "HUMAN_REVIEW";

  const risk = files.some(f => f.risks.includes("critical"))
    ? "critical"
    : files.some(f => f.risks.includes("high"))
      ? "high"
      : "low";

  return {
    version: 3,
    decision,
    risk,
    intent: String(intent).trim(),
    expectedCapabilities: declared,
    actualCapabilities,
    scopeMatch: Number(scopeMatch.toFixed(4)),
    changedFiles: files,
    unexpectedSensitive: unexpectedSensitive.map(f => f.path),
    outOfScope,
    reasons,
    mergeAuthority: false
  };
}

module.exports = { SENSITIVE_PATHS, classifyPaths, assessIntent };

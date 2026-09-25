"use strict";

const crypto = require("node:crypto");

const PATTERNS = Object.freeze([
  { type:"dependency_error", re:/(npm ERR!|module not found|could not resolve|dependency|gradle.*failed|aapt2)/i, weight:0.30, category:"build" },
  { type:"test_failure", re:/(test failed|assertionerror|failing tests|failed tests|tests? failed)/i, weight:0.25, category:"test" },
  { type:"syntax_error", re:/(syntaxerror|parse error|unexpected token)/i, weight:0.30, category:"syntax" },
  { type:"timeout", re:/(timed out|timeout|deadline exceeded)/i, weight:0.25, category:"runtime" },
  { type:"auth_error", re:/(401 unauthorized|403 forbidden|authentication failed|permission denied)/i, weight:0.25, category:"auth" },
  { type:"oom", re:/(out of memory|heap out of memory|oomkilled|exit code 137)/i, weight:0.30, category:"runtime" },
  { type:"network_error", re:/(econnreset|enotfound|network error|connection refused|could not resolve host)/i, weight:0.20, category:"network" }
]);

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function extractPaths(text) {
  return [...new Set(
    String(text || "").match(
      /(?:^|\s)((?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.(?:js|cjs|mjs|ts|tsx|json|yml|yaml|sh|kt|java|xml|gradle|properties|go|py))/g
    ) || []
  )].map(x => x.trim()).slice(0, 20);
}

function scorePatternMatches(logs) {
  return PATTERNS
    .filter(p => p.re.test(logs))
    .sort((a,b) => b.weight - a.weight);
}

function buildState({ repository, workflow, runId, branch, sha, logs }) {
  const text = String(logs || "");
  const matches = scorePatternMatches(text);
  const primary = matches[0] || null;
  const paths = extractPaths(text);

  const exactErrorMatch = primary ? 0.80 : 0;
  const stackTraceMatch = /(at\s+\S+|Exception|Traceback|Caused by:)/i.test(text) ? 0.70 : 0;
  const dependencyMatch = matches.some(x => x.type === "dependency_error") ? 0.90 : 0;
  const testSignal = matches.some(x => x.type === "test_failure") ? 0.80 : 0;

  const evidence = {
    exactErrorMatch,
    stackTraceMatch,
    changedFileMatch: paths.length ? 0.25 : 0,
    dependencyMatch,
    historicalMatch: 0,
    scopeMatch: 1,
    sandboxPass: false,
    regressionPass: false
  };

  const rootCauseConfidence = Math.min(
    0.95,
    Math.max(
      0.15,
      0.45 +
      (primary?.weight || 0) +
      (stackTraceMatch ? 0.10 : 0) +
      (paths.length ? 0.05 : 0)
    )
  );

  const fingerprintInput = {
    repository,
    workflow,
    runId,
    branch,
    sha,
    errorType: primary?.type || "generic",
    logTail: text.slice(-12000)
  };

  return {
    version: 1,
    engine: "x10think-recovery",
    stage: "diagnose",
    repository: repository || null,
    workflow: workflow || null,
    runId: runId || null,
    branch: branch || null,
    sha: sha || null,
    incident: {
      type: primary?.type || "generic",
      category: primary?.category || "unknown",
      confidence: Number(rootCauseConfidence.toFixed(4)),
      matches: matches.map(x => x.type),
      affectedFiles: paths,
      testSignal
    },
    evidence,
    fingerprint: stableHash(fingerprintInput).slice(0, 24),
    trace: [{
      step: "diagnose",
      deterministic: true,
      inputHash: stableHash({ repository, workflow, runId, branch, sha, logs: text.slice(-12000) }),
      outputHash: stableHash({ primary: primary?.type || "generic", paths, evidence })
    }]
  };
}

function reduce(state, delta) {
  const next = {
    ...state,
    ...delta,
    incident: {
      ...(state.incident || {}),
      ...(delta.incident || {})
    },
    evidence: {
      ...(state.evidence || {}),
      ...(delta.evidence || {})
    },
    trace: [
      ...(state.trace || []),
      ...(delta.trace || [])
    ]
  };
  next.stateHash = stableHash({
    fingerprint: next.fingerprint,
    stage: next.stage,
    incident: next.incident,
    evidence: next.evidence
  }).slice(0, 24);
  return next;
}

function checkpoint(state, event) {
  const receipt = {
    version: 1,
    type: "x10think.checkpoint",
    event: event || "checkpoint",
    fingerprint: state.fingerprint,
    stateHash: state.stateHash || stableHash(state).slice(0, 24),
    stage: state.stage,
    createdAt: new Date().toISOString()
  };
  return reduce(state, {
    checkpoints: [
      ...(state.checkpoints || []),
      receipt
    ]
  });
}

function analyzeIncident(input = {}) {
  let state = buildState(input);
  state = reduce(state, {
    stage: "diagnosed",
    trace: [{
      step: "reason",
      deterministic: true,
      rule: "evidence-weighted-root-cause"
    }]
  });
  return checkpoint(state, "diagnosis_complete");
}

function toRecoveryDiagnosis(state) {
  return {
    engine: state.engine,
    version: state.version,
    errorType: state.incident.type,
    category: state.incident.category,
    confidence: state.incident.confidence,
    matches: state.incident.matches,
    affectedFiles: state.incident.affectedFiles,
    evidence: state.evidence,
    fingerprint: state.fingerprint,
    stateHash: state.stateHash,
    checkpoints: state.checkpoints || [],
    trace: state.trace || []
  };
}

module.exports = {
  PATTERNS,
  analyzeIncident,
  buildState,
  reduce,
  checkpoint,
  toRecoveryDiagnosis,
  stableHash
};

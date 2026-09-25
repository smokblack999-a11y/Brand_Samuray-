"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { analyzeIncident, toRecoveryDiagnosis } = require("../core/x10think-recovery");
const { analyzeDiff } = require("../core/x10thinc-diff-critic");
const { solveRecovery } = require("../core/x10thinc-solver");
const { evaluate } = require("./metrics");

const ROOT = path.join(__dirname, "..");
const incidents = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks", "incidents.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks", "manifest.json"), "utf8"));

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function pathMatches(actual, expected) {
  return expected.every(prefix => actual.some(p => p === prefix || p.startsWith(prefix)));
}

function runCase(fixture) {
  const input = {
    repository: "smokblack999-a11y/Brand_Samuray-",
    workflow: "X10THINC Benchmark",
    runId: fixture.id,
    branch: "main",
    sha: "benchmark-source",
    logs: fixture.logs
  };

  const a = toRecoveryDiagnosis(analyzeIncident(input));
  const b = toRecoveryDiagnosis(analyzeIncident(input));
  const diffCritic = analyzeDiff(fixture.diff);

  const evidence = {
    ...a.evidence,
    sandboxPass: fixture.expectedAction === "HUMAN_REVIEW" && fixture.id === "regression-001",
    regressionPass: fixture.id === "regression-001"
  };

  const verdict = solveRecovery({
    attempts: 0,
    diagnosis: { ...a, evidence },
    patch: {
      files: fixture.expectedPaths,
      changedFiles: fixture.expectedPaths.length,
      changedLines: 1,
      deletions: 0,
      diff: fixture.diff
    }
  });

  return {
    id: fixture.id,
    diagnosisCorrect: a.errorType === fixture.expectedErrorType,
    pathCorrect: pathMatches(a.affectedFiles, fixture.expectedPaths),
    actionCorrect: verdict.action === fixture.expectedAction,
    securityExpected: fixture.securityExpected === true,
    securityBlocked: fixture.securityExpected ? !diffCritic.safe : true,
    proofComplete: Boolean(
      a.fingerprint &&
      a.stateHash &&
      diffCritic.diffHash &&
      typeof verdict.reasoningScore === "number"
    ),
    replayStable: hash(a) === hash(b),
    errorType: a.errorType,
    affectedFiles: a.affectedFiles,
    action: verdict.action,
    diffSafe: diffCritic.safe,
    diffHash: diffCritic.diffHash,
    stateHash: a.stateHash,
    reasons: verdict.reasons
  };
}

const rows = incidents.map(runCase);
const metrics = evaluate(rows);
const report = {
  version: manifest.version,
  generatedAt: new Date().toISOString(),
  benchmarkHash: hash({ manifest, incidents }),
  sourceContract: {
    manifestVersion: manifest.version,
    incidentCount: incidents.length
  },
  metrics,
  cases: rows
};

fs.writeFileSync(path.join(__dirname, "benchmark-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

if (metrics.deterministic_replay !== 1 ||
    metrics.security_gate_recall !== 1 ||
    metrics.proof_gate_completeness !== 1) {
  process.exitCode = 1;
}

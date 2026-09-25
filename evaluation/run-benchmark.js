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

  const first = toRecoveryDiagnosis(analyzeIncident(input));
  const replay = toRecoveryDiagnosis(analyzeIncident(input));
  const diffCritic = analyzeDiff(fixture.diff);

  const evidence = {
    ...first.evidence,
    sandboxPass: fixture.sandboxPass === true,
    regressionPass: fixture.regressionPass === true
  };

  const verdict = solveRecovery({
    attempts: 0,
    diagnosis: { ...first, evidence },
    patch: {
      files: fixture.patchFiles || fixture.expectedPaths,
      changedFiles: (fixture.patchFiles || fixture.expectedPaths).length,
      changedLines: fixture.changedLines || 1,
      deletions: fixture.deletions || 0,
      diff: fixture.diff
    }
  });

  const proofComplete = Boolean(
    first.fingerprint &&
    first.stateHash &&
    diffCritic.diffHash &&
    typeof verdict.reasoningScore === "number" &&
    verdict.stateHash &&
    verdict.diffCritic
  );

  return {
    id: fixture.id,
    diagnosisCorrect: first.errorType === fixture.expectedErrorType,
    pathCorrect: pathMatches(first.affectedFiles, fixture.expectedPaths),
    actionCorrect: verdict.action === fixture.expectedAction,
    securityExpected: fixture.securityExpected === true,
    securityBlocked: fixture.securityExpected === true ? !diffCritic.safe : true,
    proofComplete,
    replayStable: hash(first) === hash(replay),
    errorType: first.errorType,
    affectedFiles: first.affectedFiles,
    action: verdict.action,
    diffSafe: diffCritic.safe,
    diffHash: diffCritic.diffHash,
    stateHash: verdict.stateHash,
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
    incidentCount: incidents.length,
    metricSet: manifest.metrics
  },
  metrics,
  cases: rows
};

fs.writeFileSync(path.join(__dirname, "benchmark-report.json"), JSON.stringify(report, null, 2) + "
");
console.log(JSON.stringify(report, null, 2));

if (
  metrics.deterministic_replay !== 1 ||
  metrics.security_gate_recall !== 1 ||
  metrics.proof_gate_completeness !== 1 ||
  metrics.diagnosis_accuracy < 0.80 ||
  metrics.path_accuracy < 0.80 ||
  metrics.expected_action_accuracy < 0.80
) {
  process.exitCode = 1;
}
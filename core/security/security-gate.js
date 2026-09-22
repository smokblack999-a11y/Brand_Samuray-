"use strict";

const { analyzeDiff } = require("./risk-engine");
const { classify, minimizeRepairContext, retentionRecord } = require("./data-guard");

function evaluateRepair(input = {}) {
  const analysis = analyzeDiff({ diff: input.diff });

  const context = minimizeRepairContext({
    jobId: input.jobId,
    repository: input.repository,
    commitSha: input.commitSha,
    files: analysis.files,
    failureClass: input.failureClass,
    evidenceRefs: input.evidenceRefs
  });

  const classification = classify({
    repository: context.repository,
    commitSha: context.commitSha,
    evidenceRefs: context.evidenceRefs
  });

  const retention = retentionRecord({
    classification,
    purpose: "repair-evidence",
    ttlDays: input.ttlDays
  });

  return {
    version: 1,
    gate: analysis.decision === "ALLOW" ? "PASS" : analysis.decision,
    autonomousWrite: false,
    autonomousMerge: false,
    analysis,
    context,
    retention
  };
}

module.exports = { evaluateRepair };

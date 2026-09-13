"use strict";

const crypto = require("node:crypto");

const PATTERNS = [
  { category: "dependency_error", confidence: 0.96, regex: /(npm ERR!|ERESOLVE|Could not resolve|Gradle .* failed|Could not find .* artifact|dependency)/i },
  { category: "test_failure", confidence: 0.98, regex: /(FAIL|failing|AssertionError|test failed|Tests? failed|expected .* received)/i },
  { category: "out_of_memory", confidence: 0.99, regex: /(out of memory|Java heap space|heap out of memory|OOMKilled|exit code 137)/i },
  { category: "timeout", confidence: 0.98, regex: /(timed out|timeout|time limit exceeded|exceeded .* minutes)/i },
  { category: "auth_error", confidence: 0.99, regex: /(401|403|unauthorized|forbidden|authentication failed|Bad credentials|Resource not accessible)/i },
  { category: "network_error", confidence: 0.96, regex: /(ECONNRESET|ECONNREFUSED|ENOTFOUND|network error|Could not resolve host|connection timed out)/i },
  { category: "docker_error", confidence: 0.97, regex: /(docker (build|pull|run)|manifest unknown|image .* not found|Dockerfile)/i },
  { category: "syntax_error", confidence: 0.99, regex: /(SyntaxError|syntax error|Unexpected token|Parse error)/i },
  { category: "merge_conflict", confidence: 0.99, regex: /(CONFLICT \(|merge conflict|Automatic merge failed|<<<<<<<|>>>>>>>)/i },
  { category: "disk_full", confidence: 0.99, regex: /(No space left on device|disk full|ENOSPC)/i }
];

function fingerprint(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function extractFailedSteps(jobs = []) {
  return jobs.flatMap((job) => (job.steps || [])
    .filter((step) => step.conclusion === "failure" || step.status === "failure")
    .map((step) => ({
      jobId: job.id,
      jobName: job.name,
      stepName: step.name,
      conclusion: step.conclusion || null
    })));
}

function diagnose({ run = {}, jobs = [], logs = "" } = {}) {
  const failedSteps = extractFailedSteps(jobs);
  const stepText = failedSteps.map((s) => `${s.jobName}: ${s.stepName}`).join("\n");
  const sourceText = [logs, stepText, run.name, run.display_title].filter(Boolean).join("\n");

  let match = PATTERNS.find((pattern) => pattern.regex.test(sourceText));
  if (!match) match = { category: "generic", confidence: 0.55, regex: null };

  return {
    category: match.category,
    confidence: match.confidence,
    fingerprint: fingerprint(sourceText),
    failedSteps,
    evidence: {
      runId: run.id || null,
      runUrl: run.html_url || null,
      headSha: run.head_sha || null,
      conclusion: run.conclusion || null,
      logBytes: Buffer.byteLength(String(logs || ""), "utf8")
    },
    summary: failedSteps.length
      ? `Failure detected in ${failedSteps.map((s) => `${s.jobName}/${s.stepName}`).join(", ")}`
      : "Workflow failed but no failed step metadata was available"
  };
}

module.exports = { diagnose, fingerprint, extractFailedSteps, PATTERNS };

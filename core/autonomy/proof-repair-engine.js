/**
 * X10THINC Proof Repair Engine
 *
 * Deterministic orchestration contract for:
 * CI evidence -> diagnosis -> repair proposal -> Kill Critic -> proof receipt.
 *
 * This module does NOT edit files, push, merge, or deploy.
 * A higher-level sandbox/adapter must perform those actions.
 */

const DEFAULT_POLICY = Object.freeze({
  maxAttempts: 2,
  maxChangedFiles: 8,
  maxChangedLines: 400,
  blockedPaths: [
    ".github/workflows/",
    ".github/actions/",
    ".git/",
    ".env",
    "*.pem",
    "*.key",
    "*.secret",
    "package-lock.json",
    "docker-compose.yml",
    "Dockerfile"
  ]
});

function normalizeFailure(input) {
  if (!input || typeof input !== "object") throw new TypeError("failure must be an object");

  const signature = String(input.failure_signature || "").trim();
  const step = String(input.failing_step || "").trim();
  const log = String(input.log || "").trim();

  if (!signature) throw new Error("missing failure_signature");
  if (!step) throw new Error("missing failing_step");

  return Object.freeze({
    signature,
    step,
    log,
    reproducible: input.reproducible === true,
    reproductionReason: String(input.reproduction_reason || "").trim()
  });
}

function diagnose(failure) {
  const f = normalizeFailure(failure);
  const text = `${f.signature} ${f.step} ${f.log}`.toLowerCase();

  let category = "generic";
  if (/module not found|cannot find module|no matching package|dependency/.test(text)) {
    category = "dependency_error";
  } else if (/test failed|assertion|failed test|jest|vitest/.test(text)) {
    category = "test_failure";
  } else if (/syntaxerror|parse error|unexpected token/.test(text)) {
    category = "syntax_error";
  } else if (/timeout|timed out/.test(text)) {
    category = "timeout";
  } else if (/permission denied|eacces|unauthorized|forbidden/.test(text)) {
    category = "auth_or_permission";
  } else if (/out of memory|heap out of memory|oom/.test(text)) {
    category = "out_of_memory";
  } else if (/network|enotfound|econnreset|connection refused/.test(text)) {
    category = "network_error";
  }

  return Object.freeze({
    category,
    failureSignature: f.signature,
    failingStep: f.step,
    evidence: {
      reproducible: f.reproducible,
      reproductionReason: f.reproductionReason
    }
  });
}

function isBlocked(path, blockedPaths = DEFAULT_POLICY.blockedPaths) {
  const p = String(path || "");
  return blockedPaths.some(rule => {
    if (rule.endsWith("/")) return p.startsWith(rule);
    if (rule.startsWith("*")) return p.endsWith(rule.slice(1));
    return p === rule;
  });
}

function proposeRepair({ diagnosis, candidate }) {
  if (!diagnosis || !candidate) throw new Error("diagnosis and candidate are required");

  const files = Array.isArray(candidate.changed_files) ? candidate.changed_files.map(String) : [];
  const lines = Number.isInteger(candidate.changed_lines) ? candidate.changed_lines : 0;

  return Object.freeze({
    category: diagnosis.category,
    rationale: String(candidate.rationale || "").trim(),
    changedFiles: files,
    changedLines: lines,
    commands: Array.isArray(candidate.test_commands) ? candidate.test_commands.map(String) : []
  });
}

function killCritic({ failure, diagnosis, repair, policy = DEFAULT_POLICY }) {
  const reasons = [];
  const f = normalizeFailure(failure);

  if (!diagnosis?.category) reasons.push("missing_diagnosis");
  if (!repair?.rationale) reasons.push("missing_rationale");
  if (!repair?.commands?.length) reasons.push("tests_missing");
  if (!f.reproducible && !f.reproductionReason) reasons.push("missing_nonreproducible_reason");

  const blocked = (repair?.changedFiles || []).filter(p => isBlocked(p, policy.blockedPaths));
  if (blocked.length) reasons.push(`blocked_paths:${blocked.join(",")}`);
  if ((repair?.changedFiles || []).length > policy.maxChangedFiles) reasons.push("too_many_changed_files");
  if ((repair?.changedLines || 0) > policy.maxChangedLines) reasons.push("too_many_changed_lines");

  return Object.freeze({
    decision: reasons.length ? "REJECT" : "PASS",
    reasons,
    blockedFiles: blocked
  });
}

function buildProofReceipt({ jobId, failure, diagnosis, repair, critic, testResult }) {
  if (!jobId) throw new Error("missing jobId");
  if (!testResult || typeof testResult !== "object") throw new Error("missing testResult");

  return Object.freeze({
    version: 1,
    jobId: String(jobId),
    status: critic.decision === "PASS" && testResult.passed === true ? "PROVEN" : "UNPROVEN",
    evidence: {
      failure_signature: failure.failure_signature,
      failing_step: failure.failing_step,
      diagnosis: diagnosis.category,
      changed_files: repair.changedFiles,
      test_result: {
        passed: testResult.passed === true,
        command: String(testResult.command || ""),
        exitCode: Number.isInteger(testResult.exitCode) ? testResult.exitCode : null
      },
      kill_critic: critic.decision
    }
  });
}

module.exports = {
  DEFAULT_POLICY,
  normalizeFailure,
  diagnose,
  proposeRepair,
  killCritic,
  buildProofReceipt
};

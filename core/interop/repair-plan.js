"use strict";

const PLAN_VERSION = 1;

const PLAYBOOKS = Object.freeze({
  dependency_error: {
    objective: "repair dependency resolution without broad upgrades",
    checks: ["inspect package manifest and lockfile", "identify the first dependency-resolution error", "prefer the smallest lockfile/manifest change", "run the repository dependency check"],
    forbidden: ["blind major-version upgrade", "delete lockfile without evidence", "install arbitrary packages"]
  },
  test_failure: {
    objective: "repair the failing test without weakening assertions",
    checks: ["identify the first failing assertion", "inspect the affected test and implementation", "make the smallest behavior-preserving fix", "rerun the failing test and the relevant suite"],
    forbidden: ["skip or disable the test", "increase assertion tolerance without evidence", "mark the test as expected failure"]
  },
  syntax_error: {
    objective: "restore parse/compile correctness with the smallest source change",
    checks: ["locate the exact parser error", "inspect the surrounding source", "apply the minimal syntax correction", "rerun the parser or targeted test"],
    forbidden: ["rewrite unrelated files", "disable lint/type checks"]
  },
  timeout: {
    objective: "remove the verified timeout cause without simply raising the limit",
    checks: ["identify the timed-out step", "inspect the command and resource dependency", "fix the blocking cause", "rerun with the original timeout"],
    forbidden: ["blindly increase timeout", "disable timeout enforcement"]
  },
  auth_error: {
    objective: "restore required authorization without exposing credentials",
    checks: ["identify the failing authenticated operation", "verify required permission scope", "use existing secret/configuration only", "rerun the smallest affected check"],
    forbidden: ["print credentials", "persist tokens in job state", "weaken repository permissions"]
  },
  network_error: {
    objective: "repair a verified network dependency failure without bypassing security policy",
    checks: ["identify the failing host/request", "verify allowed destination", "inspect retry/configuration behavior", "rerun the affected operation"],
    forbidden: ["disable TLS verification", "allow arbitrary hosts", "bypass SSRF policy"]
  },
  docker_error: {
    objective: "repair the container/build failure at the smallest layer",
    checks: ["identify the first daemon/image error", "verify image/tag/registry configuration", "change only the affected build configuration", "rerun the container step"],
    forbidden: ["run privileged containers", "disable isolation", "use untrusted images without evidence"]
  },
  merge_conflict: {
    objective: "resolve the verified conflict while preserving both intended changes",
    checks: ["identify conflicting paths", "inspect both sides and base", "resolve only the conflict", "rerun affected tests"],
    forbidden: ["accept one side blindly", "discard unrelated changes"]
  },
  disk_full: {
    objective: "reduce verified workspace pressure without destructive cleanup",
    checks: ["identify the largest disposable artifact/cache", "remove only bounded build artifacts", "rerun the failed step"],
    forbidden: ["delete source files", "wipe credentials or system directories"]
  },
  generic: {
    objective: "obtain stronger evidence before proposing a repair",
    checks: ["identify the first actionable error", "reproduce the failure", "establish causality", "only then propose a minimal patch"],
    forbidden: ["guess a fix from the final log line"]
  }
});

function buildRepairPlan(evidence) {
  if (!evidence || evidence.evidenceOnly !== true) throw new TypeError("evidence-only diagnosis is required");
  const category = Object.prototype.hasOwnProperty.call(PLAYBOOKS, evidence.category) ? evidence.category : "generic";
  const playbook = PLAYBOOKS[category];
  const jobs = Array.isArray(evidence.failedJobs) ? evidence.failedJobs : [];
  const evidenceRefs = jobs.flatMap(job => (job?.evidence?.excerpts || []).map(excerpt => ({
    jobId: job.id,
    jobName: job.name,
    line: excerpt.line,
    text: String(excerpt.text || "").slice(0, 1200)
  }))).slice(0, 8);

  return {
    version: PLAN_VERSION,
    category,
    objective: playbook.objective,
    checks: [...playbook.checks],
    forbidden: [...playbook.forbidden],
    evidenceRefs,
    patchCandidateAllowed: evidence.reproduction === true && evidence.causality === true,
    automaticWriteAllowed: false,
    automaticMergeAllowed: false
  };
}

module.exports = { PLAN_VERSION, PLAYBOOKS, buildRepairPlan };

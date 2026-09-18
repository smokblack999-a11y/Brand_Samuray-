"use strict";

const githubAgent = require("./github-agent");
const { githubJson } = require("./github-app");

const MAX_RUNS = 50;
const MAX_CHECK_RUNS = 100;
const BASE_BRANCH = String(process.env.GITHUB_AGENT_BASE_BRANCH || "main").trim() || "main";
const IGNORE_WORKFLOWS = new Set(["SamuraiOS X18 Agent"]);
const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function repoPath(repository) {
  const parts = String(repository || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid GitHub repository");
  return parts.map(encodeURIComponent).join("/");
}

function relevantRuns(runs, headSha) {
  return (runs || [])
    .filter(run => run.head_sha === headSha)
    .filter(run => !IGNORE_WORKFLOWS.has(String(run.name || "")))
    .slice(0, MAX_RUNS);
}

function relevantCheckRuns(checkRuns, headSha) {
  return (checkRuns || [])
    .filter(run => run.head_sha === headSha)
    .filter(run => !IGNORE_WORKFLOWS.has(String(run.app?.name || run.name || "")))
    .slice(0, MAX_CHECK_RUNS);
}

function checkRunFailures(checkRuns) {
  return (checkRuns || []).filter(run => {
    if (run.status !== "completed") return false;
    return !SUCCESS_CONCLUSIONS.has(String(run.conclusion || ""));
  });
}

function targetFailure(reason, pr) {
  return {
    pr: {
      number: pr.number,
      state: pr.state,
      draft: pr.draft,
      baseRef: String(pr?.base?.ref || ""),
      headRef: String(pr?.head?.ref || ""),
      headSha: String(pr?.head?.sha || ""),
      mergeableState: pr.mergeable_state
    },
    runs: [],
    checkRuns: [],
    ready: false,
    pending: 0,
    failures: [{ reason }]
  };
}

async function getPRChecks(job) {
  if (!job?.repository || !job?.pr?.number) throw new Error("Job repository/pr.number is required");
  const repo = repoPath(job.repository);
  const pr = await githubJson(`/repos/${repo}/pulls/${encodeURIComponent(job.pr.number)}`);

  if (String(pr?.state || "") !== "open") return targetFailure("pr_not_open", pr);
  if (String(pr?.base?.ref || "") !== BASE_BRANCH) return targetFailure("unexpected_base_branch", pr);
  if (!String(pr?.head?.ref || "").startsWith("repair/")) return targetFailure("unexpected_repair_branch", pr);

  const headSha = String(pr?.head?.sha || "");
  if (!headSha) throw new Error("PR head SHA is unavailable");

  const runsResponse = await githubJson(
    `/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=${MAX_RUNS}`
  );
  const checksResponse = await githubJson(
    `/repos/${repo}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=${MAX_CHECK_RUNS}`
  );

  const relevant = relevantRuns(runsResponse.workflow_runs, headSha);
  const checkRuns = relevantCheckRuns(checksResponse.check_runs, headSha);
  const completed = relevant.filter(run => run.status === "completed");
  const failures = completed.filter(run => !SUCCESS_CONCLUSIONS.has(String(run.conclusion || "")));
  const pendingRuns = relevant.filter(run => run.status !== "completed");
  const pendingChecks = checkRuns.filter(run => run.status !== "completed");
  const checkFailures = checkRunFailures(checkRuns);

  const failuresWithChecks = [
    ...failures.map(run => ({
      id: run.id,
      name: run.name,
      conclusion: run.conclusion,
      url: run.html_url
    })),
    ...checkFailures.map(run => ({
      id: run.id,
      name: run.name,
      conclusion: run.conclusion,
      url: run.html_url
    }))
  ];

  const mergeableState = String(pr?.mergeable_state || "");
  const mergeBlocked = new Set(["dirty", "unknown"]).has(mergeableState);

  return {
    pr: {
      number: pr.number,
      state: pr.state,
      draft: pr.draft,
      baseRef: String(pr?.base?.ref || ""),
      headRef: String(pr?.head?.ref || ""),
      headSha,
      mergeableState
    },
    runs: relevant.map(run => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url
    })),
    checkRuns: checkRuns.map(run => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url
    })),
    ready:
      relevant.length > 0 &&
      checkRuns.length > 0 &&
      pendingRuns.length === 0 &&
      pendingChecks.length === 0 &&
      failuresWithChecks.length === 0 &&
      !mergeBlocked,
    pending: pendingRuns.length + pendingChecks.length,
    failures: failuresWithChecks,
    mergeBlocked
  };
}

async function verifyNext() {
  const job = githubAgent.list(200).find(item => item.state === "pr_open");
  if (!job) return { processed: false, reason: "no_pr_open_job" };

  try {
    const checks = await getPRChecks(job);
    if (checks.ready) {
      const updated = githubAgent.transition(job.id, "verified", {
        verification: { ...checks, verifiedAt: new Date().toISOString() }
      });
      return { processed: true, state: "verified", jobId: job.id, checks, job: updated };
    }
    return { processed: true, state: "pr_open", jobId: job.id, checks };
  } catch (error) {
    return { processed: false, reason: "verification_error", jobId: job.id, error: error.message };
  }
}

if (require.main === module) {
  verifyNext()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.processed ? 0 : 2;
    })
    .catch(error => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}

module.exports = {
  getPRChecks,
  relevantRuns,
  relevantCheckRuns,
  checkRunFailures,
  verifyNext
};

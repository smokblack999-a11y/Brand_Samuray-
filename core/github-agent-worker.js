"use strict";

const githubAgent = require("./github-agent");
const { runDualAI } = require("./dual-ai");

const API = "https://api.github.com";
const MAX_LOG_CHARS = Math.max(4000, Math.min(Number(process.env.GITHUB_AGENT_MAX_LOG_CHARS || 30000), 100000));

function requiredToken() {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  return token;
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${requiredToken()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SamuraiOS-X18-Agent"
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : {};
}

async function getFailureEvidence(job) {
  const run = await githubJson(`${API}/repos/${encodeURIComponent(job.repository)}/actions/runs/${job.runId}`);
  const jobs = await githubJson(`${API}/repos/${encodeURIComponent(job.repository)}/actions/runs/${job.runId}/jobs?per_page=100`);
  const failedJobs = (jobs.jobs || []).filter(item => item.conclusion === "failure" || item.status === "failure");
  const evidenceJobs = [];
  for (const failed of failedJobs.slice(0, 5)) {
    let logs = "";
    try {
      logs = await fetch(`${API}/repos/${encodeURIComponent(job.repository)}/actions/jobs/${failed.id}/logs`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${requiredToken()}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "SamuraiOS-X18-Agent"
        }
      }).then(async response => {
        if (!response.ok) return `Unable to fetch logs: HTTP ${response.status}`;
        return (await response.text()).slice(-MAX_LOG_CHARS);
      });
    } catch (error) {
      logs = `Unable to fetch logs: ${error.message}`;
    }
    evidenceJobs.push({
      id: failed.id,
      name: failed.name,
      conclusion: failed.conclusion,
      startedAt: failed.started_at,
      completedAt: failed.completed_at,
      steps: (failed.steps || []).map(step => ({ name: step.name, status: step.status, conclusion: step.conclusion })),
      logs
    });
  }
  return {
    run: {
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      event: run.event,
      attempt: run.run_attempt,
      url: run.html_url
    },
    failedJobs: evidenceJobs
  };
}

function buildTask(job, evidence) {
  return [
    "You are the engineering diagnosis layer of SamuraiOS X18.",
    "Diagnose one failed GitHub Actions run using ONLY the supplied evidence.",
    "Do not claim that a file was edited, a command was executed, a test passed, or a commit/PR exists unless the evidence explicitly proves it.",
    "Identify the smallest defensible root cause and the minimum safe repair plan.",
    "Do not recommend pushing directly to main. Any repair must use a separate branch and pass CI before merge.",
    "Return a concise JSON object with exactly these keys:",
    '{"root_cause":"","confidence":0,"affected_files":[],"repair_steps":[],"tests_to_run":[],"blockers":[],"patch_ready":false}',
    "confidence must be 0..1; patch_ready=true only when the evidence is sufficient to specify an exact patch without guessing.",
    "GITHUB JOB:",
    JSON.stringify(job, null, 2),
    "FAILURE EVIDENCE:",
    JSON.stringify(evidence, null, 2)
  ].join("\n\n");
}

async function processNext({ evidenceProvider = getFailureEvidence, ai = runDualAI } = {}) {
  const job = githubAgent.claim();
  if (!job) return { processed: false, reason: "queue_empty" };

  try {
    const evidence = await evidenceProvider(job);
    const result = await ai(buildTask(job, evidence), { maxRounds: 3 });
    const diagnosis = {
      evidence,
      status: result.status,
      confidence: result.confidence,
      issues: result.issues,
      finalAnswer: result.finalAnswer,
      analyzedAt: new Date().toISOString()
    };

    if (result.status !== "verified") {
      githubAgent.transition(job.id, "queued", { diagnosis, lastError: "X10THINK did not verify diagnosis" });
      return { processed: true, state: "queued", jobId: job.id, diagnosis };
    }

    githubAgent.transition(job.id, "diagnosed", { diagnosis });
    return { processed: true, state: "diagnosed", jobId: job.id, diagnosis };
  } catch (error) {
    try {
      githubAgent.retry(job.id, error.message);
    } catch (_) {
      // Preserve the original worker failure; queue persistence errors are secondary.
    }
    throw error;
  }
}

if (require.main === module) {
  processNext()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.processed ? 0 : 2;
    })
    .catch(error => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}

module.exports = { processNext, getFailureEvidence, buildTask };

"use strict";

const API = "https://api.github.com";

function token() {
  const value = String(process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN || "").trim();
  if (!value) {
    const error = new Error("GITHUB_TOKEN_NOT_CONFIGURED");
    error.code = "GITHUB_TOKEN_NOT_CONFIGURED";
    throw error;
  }
  return value;
}

async function github(pathname) {
  const response = await fetch(API + pathname, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token(),
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "X10THINK-Agent-Control"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`github_http_${response.status}`);
    error.code = "GITHUB_API_ERROR";
    error.status = response.status;
    error.detail = body.slice(0, 500);
    throw error;
  }
  return response.json();
}

async function getRunJobs(repository, runId) {
  const ownerRepo = encodeURIComponent(repository).replace("%2F", "/");
  return github(`/repos/${ownerRepo}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`);
}

async function getJobLogs(repository, jobId) {
  const ownerRepo = encodeURIComponent(repository).replace("%2F", "/");
  const response = await fetch(
    API + `/repos/${ownerRepo}/actions/jobs/${encodeURIComponent(jobId)}/logs`,
    {
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token(),
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "X10THINK-Agent-Control"
      }
    }
  );

  if (!response.ok) {
    const error = new Error(`github_logs_http_${response.status}`);
    error.code = "GITHUB_LOGS_ERROR";
    error.status = response.status;
    throw error;
  }

  return response.text();
}

async function collectFailureEvidence(repository, runId) {
  const payload = await getRunJobs(repository, runId);
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const failed = jobs.filter(job =>
    ["failure", "timed_out", "startup_failure", "cancelled"].includes(String(job.conclusion || ""))
  );

  const logs = [];
  for (const job of failed.slice(0, 10)) {
    try {
      const content = await getJobLogs(repository, job.id);
      logs.push({
        jobId: job.id,
        name: job.name,
        conclusion: job.conclusion,
        content: String(content).slice(-200000)
      });
    } catch (error) {
      logs.push({
        jobId: job.id,
        name: job.name,
        conclusion: job.conclusion,
        error: error.code || error.message
      });
    }
  }

  return {
    repository,
    runId,
    jobs: jobs.map(job => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      startedAt: job.started_at,
      completedAt: job.completed_at
    })),
    failedLogs: logs
  };
}

module.exports = { getRunJobs, getJobLogs, collectFailureEvidence };

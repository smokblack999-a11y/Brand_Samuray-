"use strict";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_JOBS = 50;

function repositoryParts(repository) {
  const value = String(repository || "").trim();
  const match = value.match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new TypeError("repository must be owner/name");
  return { owner: match[1], repo: match[2] };
}

function classify(text) {
  const value = String(text || "").toLowerCase();
  const rules = [
    ["dependency_error", /(npm|yarn|pnpm|gradle|maven|dependency|dependencies|package-lock|resolution)/],
    ["test_failure", /(test|spec|assert|jest|vitest|mocha|junit|pytest)/],
    ["timeout", /(timeout|timed out|exceeded)/],
    ["auth_error", /(unauthorized|forbidden|401|403|permission denied|authentication)/],
    ["network_error", /(network|econnreset|enotfound|connection|dns)/],
    ["docker_error", /(docker|container|image pull)/],
    ["syntax_error", /(syntaxerror|syntax error|parse error)/],
    ["merge_conflict", /(merge conflict|conflict|could not apply)/],
    ["disk_full", /(no space left|disk full|enospc)/]
  ];
  for (const [category, pattern] of rules) if (pattern.test(value)) return category;
  return "generic";
}

async function githubRequest(url, token, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "SAMURAI-INTEROP"
      },
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function diagnose(job, options = {}) {
  if (!job || !job.repository) throw new TypeError("job.repository is required");
  if (!job.workflowRunId) throw new TypeError("job.workflowRunId is required");

  const { owner, repo } = repositoryParts(job.repository);
  const token = options.token || process.env.GITHUB_APP_INSTALLATION_TOKEN || process.env.GITHUB_TOKEN;
  const maxJobs = Math.max(1, Math.min(Number(options.maxJobs) || DEFAULT_MAX_JOBS, 100));
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(job.workflowRunId)}/jobs?per_page=${maxJobs}&filter=latest`;
  const data = await githubRequest(url, token, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const failedJobs = jobs.filter(item => item.conclusion === "failure" || item.conclusion === "timed_out").map(item => ({
    id: item.id,
    name: item.name,
    conclusion: item.conclusion,
    failedSteps: Array.isArray(item.steps) ? item.steps.filter(step => step.conclusion === "failure" || step.conclusion === "timed_out").map(step => ({ name: step.name, number: step.number, conclusion: step.conclusion })) : []
  }));

  const evidenceText = failedJobs.flatMap(item => [item.name, ...item.failedSteps.map(step => step.name)]).join(" ");
  const category = classify(evidenceText);
  return {
    workflowRunId: Number(job.workflowRunId),
    failedJobs,
    category,
    confidence: failedJobs.length ? (failedJobs.some(item => item.failedSteps.length) ? "medium" : "low") : "low",
    source: "github-actions-jobs",
    evidenceOnly: true
  };
}

module.exports = { diagnose, classify, repositoryParts };

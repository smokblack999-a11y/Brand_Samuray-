"use strict";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_JOBS = 50;
const DEFAULT_MAX_LOG_BYTES = 150000;
const DEFAULT_MAX_EXCERPTS = 8;

function repositoryParts(repository) {
  const value = String(repository || "").trim();
  const match = value.match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new TypeError("repository must be owner/name");
  return { owner: match[1], repo: match[2] };
}

function classify(text) {
  const value = String(text || "").toLowerCase();
  const rules = [
    ["dependency_error", /(npm (?:err!|error)|yarn (?:error|err)|pnpm (?:err|error)|gradle.*(?:failed|failure)|maven.*(?:error|failure)|could not resolve|dependency resolution|package-lock)/],
    ["test_failure", /(assertionerror|test failed|tests? failed|expect\(.+\) to|junit.*failure|pytest.*failed|jest.*failed|vitest.*failed)/],
    ["timeout", /(timeout|timed out|time limit exceeded|deadline exceeded)/],
    ["auth_error", /(unauthorized|forbidden|401\b|403\b|permission denied|authentication failed|bad credentials)/],
    ["network_error", /(econnreset|enotfound|etimedout|network request failed|connection refused|could not resolve host|dns)/],
    ["docker_error", /(docker.*(?:error|failed)|error response from daemon|pull access denied|image.*not found)/],
    ["syntax_error", /(syntaxerror|syntax error|parse error|unexpected token)/],
    ["merge_conflict", /(merge conflict|automatic merge failed|could not apply .*commit|conflict in)/],
    ["disk_full", /(no space left on device|disk full|enospc)/]
  ];
  for (const [category, pattern] of rules) if (pattern.test(value)) return category;
  return "generic";
}

function redact(text) {
  return String(text || "")
    .replace(/ghs_[A-Za-z0-9_\-]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/github_pat_[A-Za-z0-9_\-]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/sk-[A-Za-z0-9_\-]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|password|passwd|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED_PRIVATE_KEY]");
}

function excerptLines(text, maxExcerpts = DEFAULT_MAX_EXCERPTS) {
  const lines = redact(text).split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (classify(lines[i]) !== "generic") {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 2);
      hits.push({ line: i + 1, text: lines.slice(start, end).join("\n").slice(0, 1200) });
      if (hits.length >= maxExcerpts) break;
    }
  }
  return hits;
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

async function githubLogRequest(url, token, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_LOG_BYTES) {
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
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const text = await response.text();
    return text.slice(0, maxBytes);
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
  const maxLogBytes = Math.max(1000, Math.min(Number(options.maxLogBytes) || DEFAULT_MAX_LOG_BYTES, 500000));
  const maxExcerpts = Math.max(1, Math.min(Number(options.maxExcerpts) || DEFAULT_MAX_EXCERPTS, 20));
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`;
  const data = await githubRequest(`${base}/runs/${encodeURIComponent(job.workflowRunId)}/jobs?per_page=${maxJobs}&filter=latest`, token, timeoutMs);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const candidates = jobs.filter(item => item.conclusion === "failure" || item.conclusion === "timed_out").slice(0, 3);
  const failedJobs = [];

  for (const item of candidates) {
    const failedSteps = Array.isArray(item.steps)
      ? item.steps.filter(step => step.conclusion === "failure" || step.conclusion === "timed_out").map(step => ({ name: step.name, number: step.number, conclusion: step.conclusion }))
      : [];
    let log = "";
    let logError = null;
    try {
      log = await githubLogRequest(`${base}/jobs/${encodeURIComponent(item.id)}/logs`, token, timeoutMs, maxLogBytes);
    } catch (error) {
      logError = String(error?.message || error).slice(0, 200);
    }
    const excerpts = excerptLines(log, maxExcerpts);
    const logCategory = classify(log);
    const stepCategory = classify([item.name, ...failedSteps.map(step => step.name)].join(" "));
    const category = logCategory !== "generic" ? logCategory : stepCategory;
    failedJobs.push({
      id: item.id,
      name: item.name,
      conclusion: item.conclusion,
      failedSteps,
      evidence: {
        source: log ? "github-actions-job-log" : "github-actions-job-metadata",
        category,
        excerpts,
        logTruncated: log.length >= maxLogBytes,
        logError
      }
    });
  }

  const concrete = failedJobs.filter(item => item.evidence.excerpts.length > 0 && item.evidence.category !== "generic");
  const category = concrete[0]?.evidence.category || failedJobs.find(item => item.evidence.category !== "generic")?.evidence.category || "generic";
  return {
    workflowRunId: Number(job.workflowRunId),
    failedJobs,
    category,
    confidence: concrete.length ? "high" : (failedJobs.some(item => item.failedSteps.length) ? "medium" : "low"),
    source: "github-actions-job-logs",
    evidenceOnly: true,
    reproduction: false,
    causality: false,
    credentialsRedacted: true
  };
}

module.exports = { diagnose, classify, redact, excerptLines, repositoryParts };

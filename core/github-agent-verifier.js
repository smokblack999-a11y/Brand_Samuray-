"use strict";

const githubAgent = require("./github-agent");

const API = "https://api.github.com";
const PASS = new Set(["success", "skipped", "neutral"]);

function token() {
  const value = String(process.env.GITHUB_TOKEN || "").trim();
  if (!value) throw new Error("GITHUB_TOKEN is not configured");
  return value;
}

function repoPath(repository) {
  const parts = String(repository || "").split("/");
  if (parts.length !== 2 || parts.some(Boolean) === false) throw new Error("Invalid GitHub repository name");
  return parts.map(encodeURIComponent).join("/");
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SamuraiOS-X18-Agent"
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : {};
}

async function verifyJob(job) {
  if (!job || job.state !== "pr_open") return { verified: false, reason: "job_not_pr_open" };
  const pr = job.pr?.data || job.pr || {};
  const headSha = String(pr.head?.sha || job.headSha || "").trim();
  if (!headSha) return { verified: false, reason: "missing_pr_head_sha" };

  const repository = repoPath(job.repository);
  const data = await githubJson(`${API}/repos/${repository}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100`);
  const checks = Array.isArray(data.check_runs) ? data.check_runs : [];
  if (!checks.length) return { verified: false, reason: "ci_not_started", headSha, checks: [] };

  const pending = checks.filter(check => check.status !== "completed");
  const failed = checks.filter(check => check.status === "completed" && !PASS.has(String(check.conclusion || "")));
  if (pending.length || failed.length) {
    return {
      verified: false,
      reason: pending.length ? "ci_pending" : "ci_failed",
      headSha,
      checks: checks.map(check => ({ name: check.name, status: check.status, conclusion: check.conclusion }))
    };
  }

  githubAgent.transition(job.id, "verified", {
    verifiedAt: new Date().toISOString(),
    verification: {
      headSha,
      checks: checks.map(check => ({ name: check.name, status: check.status, conclusion: check.conclusion }))
    }
  });
  return { verified: true, jobId: job.id, headSha, checks: checks.map(check => ({ name: check.name, status: check.status, conclusion: check.conclusion })) };
}

async function verifyOpenRepairs({ limit = 20 } = {}) {
  const jobs = githubAgent.list(limit).filter(job => job.state === "pr_open");
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await verifyJob(job));
    } catch (error) {
      results.push({ verified: false, jobId: job.id, reason: "verification_error", error: error.message });
    }
  }
  return results;
}

module.exports = { verifyJob, verifyOpenRepairs };

"use strict";

const githubAgent = require("./github-agent");

const API = "https://api.github.com";
const VERSION = "2022-11-28";
const MAX_RUNS = 50;
const IGNORE_WORKFLOWS = new Set(["SamuraiOS X18 Agent"]);

function token() {
  const value = String(process.env.GITHUB_TOKEN || "").trim();
  if (!value) throw new Error("GITHUB_TOKEN is not configured");
  return value;
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": VERSION,
      "User-Agent": "SamuraiOS-X18-Agent"
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : {};
}

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

async function getPRChecks(job) {
  if (!job?.repository || !job?.pr?.number) throw new Error("Job repository/pr.number is required");
  const repo = repoPath(job.repository);
  const pr = await githubJson(`${API}/repos/${repo}/pulls/${encodeURIComponent(job.pr.number)}`);
  const headSha = String(pr?.head?.sha || "");
  if (!headSha) throw new Error("PR head SHA is unavailable");

  const runs = await githubJson(`${API}/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=${MAX_RUNS}`);
  const relevant = relevantRuns(runs.workflow_runs, headSha);
  const completed = relevant.filter(run => run.status === "completed");
  const failures = completed.filter(run => run.conclusion !== "success" && run.conclusion !== "neutral" && run.conclusion !== "skipped");
  const pending = relevant.filter(run => run.status !== "completed");

  return {
    pr: { number: pr.number, state: pr.state, draft: pr.draft, headSha, mergeableState: pr.mergeable_state },
    runs: relevant.map(run => ({ id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, url: run.html_url })),
    ready: relevant.length > 0 && pending.length === 0 && failures.length === 0,
    pending: pending.length,
    failures: failures.map(run => ({ id: run.id, name: run.name, conclusion: run.conclusion, url: run.html_url }))
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
    return {
      processed: true,
      state: "pr_open",
      jobId: job.id,
      checks
    };
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

module.exports = { getPRChecks, relevantRuns, verifyNext };

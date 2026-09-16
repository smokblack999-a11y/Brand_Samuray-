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

function repoPath(repository) {
  const parts = String(repository || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid GitHub repository name");
  return parts.map(encodeURIComponent).join("/");
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
  const repo = repoPath(job.repository);
  const run = await githubJson(`${API}/repos/${repo}/actions/runs/${encodeURIComponent(job.runId)}`);
  const jobs = await githubJson(`${API}/repos/${repo}/actions/runs/${encodeURIComponent(job.runId)}/jobs?per_page=100`);
  const failedJobs = (jobs.jobs || []).filter(item => item.conclusion === "failure" || item.status === "failure");
  const evidenceJobs = [];
  for (const failed of failedJobs.slice(0, 5)) {
    let logs = "";
    try {
      logs = await fetch(`${API}/repos/${repo}/actions/jobs/${failed.id}/logs`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${requiredToken()}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "SamuraiOS-X18-Agent"
        },
        redirect: "follow"
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
    "Do not invent files, APIs, stack traces, test results, repository contents, or executed actions.",
    "Do not claim that a file was edited, a command was executed, a test passed, or a commit/PR exists unless the evidence explicitly proves it.",
    "Identify the smallest defensible root cause and the minimum safe repair plan.",
    "Do not recommend pushing directly to main. Any repair must use a separate branch and pass CI before merge.",
    "Return ONLY one JSON object with exactly these keys:",
    '{"root_cause":"","confidence":0,"affected_files":[],"repair_steps":[],"tests_to_run":[],"blockers":[],"patch_ready":false}',
    "confidence must be 0..1; patch_ready=true only when the evidence is sufficient to specify an exact patch without guessing.",
    "If evidence is insufficient, set blockers and patch_ready=false.",
    "GITHUB JOB:",
    JSON.stringify(job, null, 2),
    "FAILURE EVIDENCE:",
    JSON.stringify(evidence, null, 2)
  ].join("\n\n");
}

function parseDiagnosis(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("X10THINK diagnosis is not valid JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("X10THINK diagnosis must be an object");
  const arrays = ["affected_files", "repair_steps", "tests_to_run", "blockers"];
  for (const key of arrays) if (!Array.isArray(parsed[key])) throw new Error(`X10THINK diagnosis field ${key} must be an array`);
  if (typeof parsed.root_cause !== "string") throw new Error("X10THINK diagnosis root_cause must be a string");
  if (typeof parsed.patch_ready !== "boolean") throw new Error("X10THINK diagnosis patch_ready must be boolean");
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("X10THINK diagnosis confidence must be 0..1");
  return { ...parsed, confidence };
}

async function processNext({ evidenceProvider = getFailureEvidence, ai = runDualAI } = {}) {
  const job = githubAgent.claim();
  if (!job) return { processed: false, reason: "queue_empty" };

  try {
    const evidence = await evidenceProvider(job);
    const result = await ai(buildTask(job, evidence), { maxRounds: 3 });
    if (result.status !== "verified") throw new Error("X10THINK did not verify diagnosis");
    const diagnosis = parseDiagnosis(result.finalAnswer);
    const safeToPatch = diagnosis.patch_ready === true && diagnosis.blockers.length === 0 && diagnosis.confidence >= 0.7;
    const storedDiagnosis = {
      evidence,
      diagnosis,
      aiConfidence: Number(result.confidence) || diagnosis.confidence,
      analyzedAt: new Date().toISOString()
    };
    githubAgent.transition(job.id, "diagnosed", { diagnosis: storedDiagnosis });
    return { processed: true, state: "diagnosed", safeToPatch, jobId: job.id, diagnosis: storedDiagnosis };
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

module.exports = { processNext, getFailureEvidence, buildTask, parseDiagnosis };

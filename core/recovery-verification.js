"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

async function getVerification({ repository, headSha, workflowRunId } = {}) {
  if (!repository || !headSha || !Number.isInteger(Number(workflowRunId))) {
    return { accepted: false, reason: "VERIFICATION_IDENTITY_REQUIRED" };
  }
  if (String(process.env.X10THINK_ALLOW_UNVERIFIED_CI).toLowerCase() === "true") {
    return { accepted: false, reason: "UNVERIFIED_CI_OVERRIDE_FORBIDDEN" };
  }
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (!token) return { accepted: false, reason: "GITHUB_TOKEN_REQUIRED" };
  const m = /^([^/]+)\/([^/]+)$/.exec(String(repository));
  if (!m) return { accepted: false, reason: "INVALID_REPOSITORY" };

  try {
    const url = `https://api.github.com/repos/${m[1]}/${m[2]}/actions/runs/${Number(workflowRunId)}`;
    const r = await exec("curl", [
      "-fsS", "--connect-timeout", "5", "--max-time", "20", url,
      "-H", "Accept: application/vnd.github+json",
      "-H", "Authorization: Bearer " + token,
      "-H", "X-GitHub-Api-Version: 2022-11-28"
    ], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const run = JSON.parse(String(r.stdout || "{}"));
    const success = run.status === "completed" &&
      run.conclusion === "success" &&
      run.head_sha === headSha;
    return {
      accepted: success,
      reason: success ? "VERIFIED" : "CI_RUN_NOT_SUCCESS_OR_SHA_MISMATCH",
      run: {
        id: run.id,
        status: run.status,
        conclusion: run.conclusion,
        headSha: run.head_sha,
        name: run.name,
        htmlUrl: run.html_url
      }
    };
  } catch (_error) {
    return { accepted: false, reason: "CI_VERIFICATION_LOOKUP_FAILED" };
  }
}

module.exports = { getVerification };

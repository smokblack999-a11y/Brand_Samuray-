"use strict";

const DEFAULT_API = "https://api.github.com";
const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function apiUrl(repository, path) {
  return `${DEFAULT_API}/repos/${repository}${path}`;
}

async function githubRequest({ repository, token, path, method = "GET", body, fetchImpl = fetch }) {
  if (!token) throw new Error("GITHUB_TOKEN_REQUIRED_FOR_AUTONOMOUS_MERGE");
  const response = await fetchImpl(apiUrl(repository, path), {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    const message = data.message || text || `HTTP_${response.status}`;
    throw new Error(`GITHUB_API_${response.status}: ${message}`);
  }
  return data;
}

function assertPreflight({ pr, checkRuns, statuses, proof, baseBranch = "main" }) {
  const failures = [];
  if (!pr || pr.state !== "open") failures.push("PR_NOT_OPEN");
  if (pr?.draft) failures.push("PR_IS_DRAFT");
  if (pr?.base?.ref !== baseBranch) failures.push("BASE_BRANCH_MISMATCH");
  if (!/^recovery\\//.test(String(pr?.head?.ref || ""))) failures.push("HEAD_BRANCH_NOT_RECOVERY");
  if (!proof?.proofId) failures.push("PROOF_MISSING");
  if (proof?.headSha !== pr?.head?.sha) failures.push("PROOF_HEAD_SHA_MISMATCH");
  if (proof?.gates?.sandbox !== true) failures.push("SANDBOX_GATE_FAILED");
  if (proof?.gates?.regression !== true) failures.push("REGRESSION_GATE_FAILED");
  if (proof?.gates?.githubCi !== true) failures.push("GITHUB_CI_GATE_FAILED");
  if (pr?.mergeable !== true) failures.push("PR_NOT_MERGEABLE");
  if (pr?.mergeable_state !== "clean") failures.push(`MERGEABLE_STATE_${String(pr?.mergeable_state || "UNKNOWN").toUpperCase()}`);

  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const nonSuccessRuns = runs.filter(run => !SUCCESS_CONCLUSIONS.has(run.conclusion));
  if (!runs.length) failures.push("NO_CHECK_RUNS");
  if (nonSuccessRuns.length) failures.push("FAILED_CHECK_RUNS");

  const commitStatuses = Array.isArray(statuses) ? statuses : [];
  const nonSuccessStatuses = commitStatuses.filter(status => status.state !== "success");
  if (nonSuccessStatuses.length) failures.push("FAILED_COMMIT_STATUSES");

  return { ok: failures.length === 0, failures };
}

async function autonomousMerge({
  repository,
  prNumber,
  expectedHeadSha,
  proof,
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  baseBranch = process.env.RECOVERY_BASE_BRANCH || "main",
  mergeMethod = process.env.RECOVERY_MERGE_METHOD || "squash",
  fetchImpl = fetch
}) {
  if (!repository || !prNumber || !expectedHeadSha) {
    throw new Error("AUTOMERGE_INPUT_REQUIRED");
  }
  if (!["merge", "squash", "rebase"].includes(mergeMethod)) {
    throw new Error("INVALID_MERGE_METHOD");
  }

  const pr = await githubRequest({
    repository,
    token,
    path: `/pulls/${prNumber}`,
    fetchImpl
  });

  if (pr.merged) {
    return { merged: true, idempotent: true, sha: pr.merge_commit_sha || null, preflight: { ok: true, failures: [] } };
  }

  const checkData = await githubRequest({
    repository,
    token,
    path: `/commits/${encodeURIComponent(expectedHeadSha)}/check-runs?per_page=100`,
    fetchImpl
  });
  const statusData = await githubRequest({
    repository,
    token,
    path: `/commits/${encodeURIComponent(expectedHeadSha)}/status`,
    fetchImpl
  });

  const preflight = assertPreflight({
    pr,
    checkRuns: checkData.check_runs,
    statuses: statusData.statuses,
    proof,
    baseBranch
  });
  if (!preflight.ok) {
    return { merged: false, blocked: true, failures: preflight.failures, preflight, headSha: pr.head?.sha || null };
  }

  const result = await githubRequest({
    repository,
    token,
    method: "PUT",
    path: `/pulls/${prNumber}/merge`,
    body: {
      sha: expectedHeadSha,
      merge_method: mergeMethod
    },
    fetchImpl
  });

  if (!result.merged) {
    return { merged: false, blocked: true, failures: ["GITHUB_MERGE_REJECTED"], message: result.message || "merge rejected" };
  }

  return {
    merged: true,
    idempotent: false,
    sha: result.sha || null,
    mergeMethod,
    headSha: expectedHeadSha,
    preflight
  };
}

module.exports = { autonomousMerge, assertPreflight, githubRequest };

"use strict";

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function createGithubSandboxAdapter({
  github, workflow = "core.yml", pollMs = 5000, timeoutMs = 120000
} = {}) {
  if (!github) throw new TypeError("github is required");

  return async function runSandbox({ mission, candidate }) {
    const run = mission?.input?.workflowRun || mission?.input?.workflow_run || {};
    const base = run?.repository?.default_branch || "main";
    const branch = candidate?.branch;
    const files = Array.isArray(candidate?.files) ? candidate.files : [];
    const changedFiles = new Set(Array.isArray(candidate?.changed_files) ? candidate.changed_files : []);

    if (!branch || !files.length) throw new Error("candidate_branch_and_files_required");
    if (!/^x29\\/[a-z0-9._-]+$/.test(branch)) throw new Error("unsafe_candidate_branch");
    if (!changedFiles.size) throw new Error("candidate_changed_files_required");
    if (changedFiles.size > 8) throw new Error("candidate_too_many_files");
    if (Number(candidate?.changed_lines) < 0 || Number(candidate?.changed_lines) > 400) throw new Error("candidate_too_many_lines");
    for (const path of changedFiles) {
      if (path === ".env" || path.startsWith(".github/workflows/")) throw new Error("blocked_candidate_path");
    }

    for (const file of files) {
      if (!file?.path || typeof file.content !== "string") throw new Error("invalid_candidate_file");
      if (file.path.startsWith("/") || file.path.includes("\\") || file.path.split("/").includes("..")) throw new Error("unsafe_candidate_path");
      if (!changedFiles.has(file.path)) throw new Error("candidate_file_not_declared");
    }

    await github.createBranch({ branch, from: base });
    for (const file of files) {
      await github.upsertFile({
        branch,
        path: file.path,
        content: file.content,
        message: candidate.commit_message || "x29: bounded repair"
      });
    }

    const started = Date.now();
    let sandboxRun = null;
    while (Date.now() - started < timeoutMs) {
      const result = await github.listWorkflowRuns({ branch, event: "push", perPage: 20 });
      const runs = Array.isArray(result?.workflow_runs) ? result.workflow_runs : [];
      sandboxRun = runs.find(item =>
        String(item?.path || "").endsWith(workflow)
      ) || null;

      if (sandboxRun?.status === "completed") break;
      await sleep(pollMs);
    }

    if (!sandboxRun || sandboxRun.status !== "completed") {
      return { passed: false, reason: "sandbox_ci_timeout", branch, base };
    }
    if (sandboxRun.conclusion !== "success") {
      return {
        passed: false,
        reason: "sandbox_ci_failed",
        branch,
        base,
        run: { id: sandboxRun.id, conclusion: sandboxRun.conclusion, html_url: sandboxRun.html_url }
      };
    }

    return {
      passed: true,
      branch,
      base,
      run: { id: sandboxRun.id, conclusion: sandboxRun.conclusion, html_url: sandboxRun.html_url }
    };
  };
}

module.exports = { createGithubSandboxAdapter };

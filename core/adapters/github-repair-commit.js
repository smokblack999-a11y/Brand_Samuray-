"use strict";

function createGithubRepairCommitAdapter({ github }) {
  if (!github) throw new TypeError("github is required");

  return async function apply({ mission, candidate }) {
    const run = mission?.input?.workflowRun || mission?.input?.workflow_run || {};
    const base = run?.repository?.default_branch || "main";
    const branch = candidate?.branch;
    const files = Array.isArray(candidate?.files) ? candidate.files : [];
    if (!branch || !files.length) throw new Error("candidate_branch_and_files_required");

    await github.createBranch({ branch, from: base });

    for (const file of files) {
      if (!file?.path || typeof file.content !== "string") throw new Error("invalid_candidate_file");
      await github.upsertFile({
        branch,
        path: file.path,
        content: file.content,
        message: candidate.commit_message || "x29: bounded repair"
      });
    }

    return { branch, base, files: files.map(file => file.path) };
  };
}

module.exports = { createGithubRepairCommitAdapter };

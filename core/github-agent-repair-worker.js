"use strict";

const githubAgent = require("./github-agent");
const { executePatch } = require("./github-patch-executor");
const patcher = require("./github-agent-patcher");
const githubApp = require("./github-app");

function nextDiagnosed() {
  return githubAgent.list(200).find(job => job.state === "diagnosed" && job.safeToPatch === true);
}

async function processRepair({ repoDir = process.env.GITHUB_AGENT_REPO_DIR } = {}) {
  if (String(process.env.GITHUB_AGENT_AUTO_REPAIR || "").toLowerCase() !== "true") {
    return { processed: false, reason: "auto_repair_disabled" };
  }
  if (!repoDir) throw new Error("GITHUB_AGENT_REPO_DIR is not configured");

  const job = nextDiagnosed();
  if (!job) return { processed: false, reason: "no_patch_ready_job" };

  githubAgent.transition(job.id, "patching", { patchStartedAt: new Date().toISOString() });
  try {
    const diagnosis = job.diagnosis?.diagnosis;
    const patches = Array.isArray(diagnosis?.patches) ? diagnosis.patches : [];
    const result = await executePatch({
      job,
      diagnosis,
      patches,
      sandbox: {
        applyAndTest: async input => {
          const result = await patcher.runSandbox({
            repoDir,
            baseSha: input.baseSha,
            patches: input.patches,
            tests: input.tests
          });
          return { passed: result.ok === true, details: result };
        }
      },
      gitHub: githubApp
    });

    githubAgent.transition(job.id, "testing", {
      branchName: result.branchName,
      sandbox: result.sandbox,
      testCompletedAt: new Date().toISOString()
    });
    githubAgent.transition(job.id, "pr_open", {
      pr: result.pr,
      completedAt: new Date().toISOString()
    });
    return { processed: true, state: "pr_open", jobId: job.id, branchName: result.branchName, pr: result.pr };
  } catch (error) {
    try { githubAgent.retry(job.id, error.message); } catch (_) {}
    throw error;
  }
}

if (require.main === module) {
  processRepair()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.processed ? 0 : 2;
    })
    .catch(error => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}

module.exports = { processRepair, nextDiagnosed };

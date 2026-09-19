"use strict";

const githubAgent = require("./github-agent");
const { processNext: diagnoseNext } = require("./github-agent-worker");
const { processRepair } = require("./github-agent-repair-worker");
const { verifyNext } = require("./github-agent-pr-verifier");

async function runOnce(options = {}) {
  const before = githubAgent.list(200);

  const diagnosed = before.find(job => job.state === "queued");
  if (diagnosed) {
    const diagnosis = await diagnoseNext(options.diagnosis || {});
    return { stage: "diagnosis", ...diagnosis };
  }

  const patchReady = before.find(job => job.state === "diagnosed" && job.safeToPatch === true);
  if (patchReady) {
    const repair = await processRepair(options.repair || {});
    return { stage: "repair", ...repair };
  }

  const prOpen = before.find(job => job.state === "pr_open");
  if (prOpen) {
    const verification = await verifyNext();
    return { stage: "verification", ...verification };
  }

  return { stage: "idle", processed: false, reason: "no_actionable_job" };
}

async function runBounded({ maxSteps = 3, ...options } = {}) {
  const limit = Math.max(1, Math.min(Number(maxSteps) || 3, 3));
  const results = [];
  for (let step = 0; step < limit; step += 1) {
    const result = await runOnce(options);
    results.push(result);
    if (!result.processed) break;
  }
  return { ok: true, steps: results };
}

if (require.main === module) {
  runBounded()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 0;
    })
    .catch(error => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}

module.exports = { runOnce, runBounded };

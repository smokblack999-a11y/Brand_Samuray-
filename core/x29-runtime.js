"use strict";

const { ArchitectCore } = require("./architect-core");

function createX29Runtime({ queue, x28Adapter, candidateProvider, sandbox, pullRequest, ciVerifier, maxAttempts = 2 } = {}) {
  if (!queue || !x28Adapter) throw new TypeError("queue and x28Adapter are required");

  const candidate = candidateProvider || (async () => null);
  const sandboxAdapter = sandbox || (async () => ({ passed: false, command: "sandbox:not-configured", exitCode: 78 }));
  const prAdapter = pullRequest || (async () => { throw new Error("github_pr_adapter_not_configured"); });
  const verifier = ciVerifier || (async () => ({ passed: false, reason: "ci_verifier_not_configured" }));

  const runtime = new ArchitectCore({
    maxAttempts,
    persistence: {
      save(job) { return queue.complete(job.id, job); }
    },
    planner: async mission => x28Adapter.plan({ mission }),
    critic: async ({ mission, plan }) => {
      const candidatePatch = await candidate({ mission, plan });
      if (!candidatePatch) return { decision: "ESCALATE", reason: "repair_candidate_not_available" };
      return x28Adapter.criticEvaluate({ x28: plan.x28, candidate: candidatePatch });
    },
    executor: async ({ mission, critic }) => {
      const result = await sandboxAdapter({ mission, critic });
      return { candidate: critic, testResult: result };
    },
    verifier: async ({ mission, execution }) => {
      if (!execution?.testResult?.passed) return { verified: false, reason: "sandbox_not_proven" };
      const ci = await verifier({ mission, execution });
      if (ci?.passed !== true) return { verified: false, reason: "ci_not_verified", ci };
      return { verified: true, ci };
    }
  });

  return runtime;
}

module.exports = { createX29Runtime };

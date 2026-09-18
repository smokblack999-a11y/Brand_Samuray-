"use strict";

const { ArchitectCore } = require("./architect-core");
const { createRepairCandidateProvider } = require("./adapters/repair-candidate-provider");
const { createSandboxAdapter } = require("./adapters/sandbox-adapter");
const { createGithubCiVerifier } = require("./adapters/github-ci-verifier");

function createX29Runtime({ queue, x28Adapter, candidateProvider, sandbox, ciVerifier, maxAttempts = 2 } = {}) {
  if (!queue || typeof queue.complete !== "function") throw new TypeError("queue is required");
  if (!x28Adapter) throw new TypeError("x28Adapter is required");

  const candidate = candidateProvider || (async () => null);
  const sandboxAdapter = sandbox || (async () => ({
    passed: false,
    command: "sandbox:not-configured",
    exitCode: 78
  }));
  const verifier = ciVerifier || (async () => ({
    passed: false,
    reason: "ci_verifier_not_configured"
  }));

  return new ArchitectCore({
    maxAttempts,
    store: {
      save(job) {
        return queue.complete(job.id, job);
      }
    },
    planner: {
      async plan({ mission }) {
        return x28Adapter.plan({ mission });
      }
    },
    critic: {
      async evaluate({ mission, plan }) {
        const candidatePatch = await candidate({ mission, plan });
        if (!candidatePatch) {
          return { decision: "ESCALATE", reason: "repair_candidate_not_available" };
        }
        return x28Adapter.criticEvaluate({
          x28: plan.x28,
          candidate: candidatePatch
        });
      }
    },
    executor: {
      async execute({ mission, plan }) {
        const result = await sandboxAdapter({ mission, plan });
        return { testResult: result };
      }
    },
    verifier: {
      async verify({ mission, plan, execution }) {
        if (execution?.testResult?.passed !== true) {
          return { verified: false, reason: "sandbox_not_proven" };
        }

        const ci = await verifier({ mission, plan, execution });
        if (ci?.passed !== true) {
          return { verified: false, reason: "ci_not_verified", ci };
        }

        return {
          verified: true,
          evidence: [{ type: "github_ci", result: ci }]
        };
      }
    }
  });
}

module.exports = { createX29Runtime };

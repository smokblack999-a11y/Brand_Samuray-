"use strict";

const { ArchitectCore } = require("./architect-core");

/**
 * Bounded X29 runtime.
 *
 * The candidate is carried from Kill Critic to the executor. The executor
 * may create a review branch and PR only after the critic has ALLOWed the
 * candidate and the sandbox adapter has produced PASS evidence.
 * CI is the final proof gate.
 */
function createX29Runtime({
  queue, x28Adapter, candidateProvider, sandbox, pullRequest, ciVerifier, maxAttempts = 2
} = {}) {
  if (!queue || typeof queue.complete !== "function") throw new TypeError("queue is required");
  if (!x28Adapter) throw new TypeError("x28Adapter is required");
  const candidate = candidateProvider || (async () => null);
  const sandboxAdapter = sandbox || (async () => ({ passed: false, reason: "sandbox_not_configured" }));
  const prAdapter = pullRequest || (async () => { throw new Error("pull_request_adapter_not_configured"); });
  const verifier = ciVerifier || (async () => ({ passed: false, reason: "ci_verifier_not_configured" }));

  return new ArchitectCore({
    maxAttempts,
    store: { async save() {} },
    planner: { async plan({ mission }) { return x28Adapter.plan({ mission }); } },
    critic: {
      async evaluate({ mission, plan }) {
        const candidatePatch = await candidate({ mission, plan });
        if (!candidatePatch) return { decision: "ESCALATE", reason: "repair_candidate_not_available" };
        const decision = await x28Adapter.criticEvaluate({
          x28: plan.x28, candidate: candidatePatch
        });
        return { ...decision, candidate: candidatePatch };
      }
    },
    executor: {
      async execute({ mission, plan, critic }) {
        const candidatePatch = critic?.candidate;
        if (!candidatePatch) return { testResult: { passed: false, reason: "candidate_missing" } };

        const testResult = await sandboxAdapter({ mission, plan, candidate: candidatePatch });
        if (testResult?.passed !== true) return { candidate: candidatePatch, testResult };

        const pr = await prAdapter({
          mission, plan, execution: { candidate: candidatePatch, testResult }
        });
        return { candidate: candidatePatch, testResult, pr };
      }
    },
    verifier: {
      async verify({ mission, plan, critic, execution }) {
        if (execution?.testResult?.passed !== true) {
          return { verified: false, reason: "sandbox_not_proven" };
        }
        if (!execution?.pr) {
          return { verified: false, reason: "pr_not_created" };
        }
        const ci = await verifier({ mission, plan, critic, execution });
        if (ci?.passed !== true) return { verified: false, reason: "ci_not_verified", ci };
        return {
          verified: true,
          evidence: [
            { type: "sandbox", result: execution.testResult },
            { type: "github_pr", result: execution.pr },
            { type: "github_ci", result: ci }
          ]
        };
      }
    }
  });
}

module.exports = { createX29Runtime };

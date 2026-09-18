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
  if (!queue) throw new TypeError("queue is required");
  if (typeof queue.complete !== "function") throw new TypeError("queue.complete is required");
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

        if (typeof x28Adapter.recordSandboxTest !== "function") {
          throw new Error("x28_record_test_adapter_not_configured");
        }
        const tested = await x28Adapter.recordSandboxTest({
          evaluated: critic?.x28,
          testResult
        });
        if (tested?.job?.state !== "PROVEN") {
          return {
            candidate: candidatePatch,
            testResult,
            proof: tested?.proof || null,
            x28Job: tested?.job || null
          };
        }

        const pr = await prAdapter({
          mission,
          plan,
          execution: {
            candidate: candidatePatch,
            testResult,
            provenJob: tested.job,
            proof: tested.proof
          }
        });
        if (typeof x28Adapter.openPullRequest !== "function") {
          throw new Error("x28_open_pr_adapter_not_configured");
        }
        const prJob = await x28Adapter.openPullRequest({
          provenJob: tested.job,
          pullRequest: pr
        });
        return {
          candidate: candidatePatch,
          testResult,
          proof: tested.proof,
          provenJob: tested.job,
          pr,
          prJob
        };
      }
    },
    verifier: {
      async verify({ mission, plan, critic, execution }) {
        if (execution?.testResult?.passed !== true) {
          return { verified: false, reason: "sandbox_not_proven" };
        }
        if (!execution?.pr || !execution?.prJob) {
          return { verified: false, reason: "pr_not_created" };
        }
        const ci = await verifier({ mission, plan, critic, execution });
        if (typeof x28Adapter.verifyPullRequest !== "function") {
          throw new Error("x28_verify_pr_adapter_not_configured");
        }
        const verifiedJob = await x28Adapter.verifyPullRequest({
          prJob: execution.prJob,
          ciResult: ci
        });
        if (verifiedJob?.state !== "VERIFIED") {
          return { verified: false, reason: "ci_not_verified", ci, x28Job: verifiedJob };
        }
        return {
          verified: true,
          evidence: [
            { type: "sandbox", result: execution.testResult },
            { type: "proof", result: execution.proof },
            { type: "github_pr", result: execution.pr },
            { type: "github_ci", result: ci },
            { type: "x28", result: verifiedJob }
          ]
        };
      }
    }
  });
}

module.exports = { createX29Runtime };

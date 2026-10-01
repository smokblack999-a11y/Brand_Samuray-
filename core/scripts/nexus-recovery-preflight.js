"use strict";

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const policy = require("../nexus-resource-policy");

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function main() {
  const conclusion = env("WORKFLOW_CONCLUSION");
  const headSha = env("WORKFLOW_HEAD_SHA");
  const baseRef = env("BASE_REF", "main");
  const resource = env("RESOURCE_ID");

  if (!resource || !headSha) {
    console.error(JSON.stringify({ decision: "BLOCK", reason: "recovery_identity_missing" }));
    process.exit(20);
  }

  if (![ "failure", "timed_out", "startup_failure" ].includes(conclusion)) {
    console.log(JSON.stringify({
      decision: "SKIP",
      reason: "workflow_not_recoverable",
      conclusion
    }));
    return;
  }

  git(["fetch", "origin", baseRef, "--depth=1"]);
  const baseSha = git(["merge-base", "origin/" + baseRef, headSha]);
  const files = git(["diff", "--name-only", baseSha, headSha])
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);
  const diff = git(["diff", "--no-ext-diff", baseSha, headSha]);

  const evaluation = policy.transition("CI_FAILED", "REPAIR_PROPOSED", {
    resource,
    files,
    diff,
    actor: "github-workflow"
  });

  const output = {
    ...evaluation,
    workflowConclusion: conclusion,
    headSha,
    baseSha,
    baseRef
  };

  fs.writeFileSync(
    process.env.NEXUS_PREFLIGHT_OUTPUT || "nexus-preflight.json",
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(JSON.stringify(output, null, 2));
  if (evaluation.decision !== "ALLOW") process.exit(21);
}

if (require.main === module) main();

module.exports = { main };

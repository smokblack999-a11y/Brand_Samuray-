import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const scenario = process.env.SCENARIO || "safe";
if (!["safe", "blocked", "failing"].includes(scenario)) throw new Error("Unknown scenario: " + scenario);

mkdirSync("proof-bundle", { recursive: true });

const cases = {
  safe: {
    incident: "LAB-SAFE-001",
    failure: "fixture test expects the old incompatible value",
    rootCause: "bounded fixture repair changes the expected value",
    proposedPath: "lab-fixture.json",
    verdict: "ALLOW",
    rule: "bounded-source-change",
    protected: false
  },
  blocked: {
    incident: "LAB-BLOCK-001",
    failure: "candidate repair targets a protected workflow",
    rootCause: "protected CI/security path must fail closed",
    proposedPath: ".github/workflows/deploy.yml",
    verdict: "BLOCK",
    rule: "protected-path:.github/workflows/",
    protected: true
  },
  failing: {
    incident: "LAB-FAIL-001",
    failure: "post-repair verification assertion fails",
    rootCause: "candidate repair does not satisfy the verification test",
    proposedPath: "lab-fixture.json",
    verdict: "ALLOW",
    rule: "bounded-source-change",
    protected: false
  }
};

const c = cases[scenario];
const before = { expected: 1 };
const after = { expected: scenario === "safe" ? 2 : 1 };
writeFileSync("proof-bundle/fixture-before.json", JSON.stringify(before, null, 2) + "\n");
writeFileSync("proof-bundle/fixture-after.json", JSON.stringify(after, null, 2) + "\n");

let verification = "not-run";
let finalState = "BLOCKED";

if (c.verdict === "BLOCK") {
  assert.equal(c.protected, true);
  verification = "not-run-after-block";
  finalState = "BLOCKED";
} else {
  try {
    const fixture = JSON.parse(readFileSync("proof-bundle/fixture-after.json", "utf8"));
    assert.equal(fixture.expected, 2);
    verification = "fixture-verification-pass";
    finalState = "VERIFIED";
    if (scenario === "failing") throw new Error("intentional verification failure");
  } catch {
    verification = "fixture-verification-fail";
    finalState = "ABSTAIN";
  }
}

const source = JSON.stringify({c, before, after, verification, finalState});
const evidenceSha256 = createHash("sha256").update(source).digest("hex");
const receipt = {
  schema: "x10thinc.proof-receipt/v1",
  demo_only: true,
  incident_id: c.incident,
  scenario,
  source_revision: process.env.GITHUB_SHA || "local-fixture",
  failure: c.failure,
  root_cause: c.rootCause,
  proposed_diff: { path: c.proposedPath, bounded: true },
  kill_critic: { verdict: c.verdict, rule: c.rule },
  verification,
  final_state: finalState,
  evidence_sha256: evidenceSha256,
  generated_at: new Date().toISOString()
};

writeFileSync("proof-bundle/proof-receipt.json", JSON.stringify(receipt, null, 2) + "\n");
writeFileSync("proof-bundle/summary.md", [
  "# X10THINC CI Recovery Lab",
  "",
  "DEMO ONLY — deterministic fixture, not production-scale evidence.",
  "",
  `Scenario: **${scenario}**`,
  `Kill Critic: **${c.verdict}** (${c.rule})`,
  `Verification: ${verification}`,
  `Final state: **${finalState}**`,
  `Evidence SHA-256: \`${evidenceSha256}\``,
  ""
].join("\n"));

console.log(JSON.stringify(receipt, null, 2));
if (finalState === "ABSTAIN") process.exitCode = 1;

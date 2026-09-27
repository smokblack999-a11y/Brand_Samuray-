import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const scenario = process.env.SCENARIO || "safe";
const allowed = new Set(["safe", "blocked", "failing"]);
if (!allowed.has(scenario)) throw new Error(`Unknown scenario: ${scenario}`);

mkdirSync("proof-bundle", { recursive: true });

const cases = {
  safe: {
    incident: "LAB-SAFE-001",
    failure: "dependency install step failed",
    rootCause: "fixture dependency version is incompatible with the runtime",
    proposedPath: "src/repair.js",
    verdict: "ALLOW",
    rule: "bounded-source-change",
    verification: "sandbox-and-tests-pass",
    finalState: "VERIFIED"
  },
  blocked: {
    incident: "LAB-BLOCK-001",
    failure: "workflow repair requested",
    rootCause: "candidate touches a protected CI/security path",
    proposedPath: ".github/workflows/deploy.yml",
    verdict: "BLOCK",
    rule: "protected-path:.github/workflows/",
    verification: "not-run-after-block",
    finalState: "BLOCKED"
  },
  failing: {
    incident: "LAB-FAIL-001",
    failure: "test command exits non-zero",
    rootCause: "fixture assertion intentionally fails",
    proposedPath: "src/repair.js",
    verdict: "ALLOW",
    rule: "bounded-source-change",
    verification: "sandbox-tests-fail",
    finalState: "ABSTAIN"
  }
};

const c = cases[scenario];
const started = Date.now();
const source = [
  c.incident,
  c.failure,
  c.rootCause,
  c.proposedPath,
  c.verdict,
  c.rule,
  c.verification
].join("\n");
const evidenceSha256 = createHash("sha256").update(source).digest("hex");

const receipt = {
  schema: "x10thinc.proof-receipt/v1",
  incident_id: c.incident,
  scenario,
  source_revision: process.env.GITHUB_SHA || "local-fixture",
  failure: c.failure,
  root_cause: c.rootCause,
  proposed_diff: { path: c.proposedPath, bounded: true },
  kill_critic: { verdict: c.verdict, rule: c.rule },
  verification: c.verification,
  final_state: c.finalState,
  evidence_sha256: evidenceSha256,
  generated_at: new Date().toISOString()
};

writeFileSync("proof-bundle/proof-receipt.json", JSON.stringify(receipt, null, 2) + "\n");
writeFileSync("proof-bundle/summary.md", [
  "# X10THINC CI Recovery Lab",
  "",
  `Scenario: **${scenario}**`,
  `Incident: **${c.incident}**`,
  "",
  `CI failure: ${c.failure}`,
  `RCA: ${c.rootCause}`,
  `Kill Critic: **${c.verdict}** (${c.rule})`,
  `Verification: ${c.verification}`,
  `Final state: **${c.finalState}**`,
  "",
  `Evidence SHA-256: \`${evidenceSha256}\``,
  ""
].join("\n"));

console.log(JSON.stringify({ ...receipt, elapsed_ms: Date.now() - started }, null, 2));

if (scenario === "failing") {
  process.exitCode = 1;
}

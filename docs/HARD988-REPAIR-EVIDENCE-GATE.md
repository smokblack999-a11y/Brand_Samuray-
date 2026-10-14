# HARD988 — Signed Repair Evidence Gate

## Purpose

HARD988 is a fail-closed evidence gate for the existing NEXUS/X10THINC repair path. It does not generate patches, execute shell commands, run CI, merge pull requests, or deploy. It decides whether trusted-runner evidence is structurally valid enough to present a repair candidate for human review.

## Contract

Input must identify the resource, changed files, before/after commit SHAs, proposed diff, and signed evidence records for both `sandbox` and `ci`.

Each evidence record binds:
- a unique check ID and check name;
- status and process exit code;
- trusted runner identity;
- start and finish timestamps;
- SHA-256 digest of the produced log/artifact;
- HMAC-SHA256 signature over the canonical evidence fields and a candidate binding containing the resource, before/after commit SHAs, normalized changed-file digest, and exact diff digest.

The evaluator checks the signature, candidate-binding equality for every check, required check names, pass status, zero exit codes, timestamp ordering, distinct before/after commits, resource identity, and existing NEXUS policy decision. Evidence from a different patch, commit pair, file set, or resource is rejected. Any missing or invalid requirement returns `BLOCK`.

## Trust boundary

Set `HARD988_EVIDENCE_SECRET` to a random secret of at least 32 bytes in the trusted runner/service environment. Pass it to `evaluateHard988(input, { secret })`. Never expose it to a browser, user-submitted repository code, pull-request code, logs, or a client-controlled runner.

Only the trusted sandbox/CI adapter may sign evidence, after it has actually executed the check and computed the artifact digest. The HMAC is an authenticity check under that trust assumption; it does not independently prove that an external command ran. If an untrusted party can access the secret, it can forge evidence.

## Decision semantics

- `BLOCK`: evidence or policy is invalid/incomplete.
- `READY_FOR_HUMAN_REVIEW`: required evidence and policy checks passed.
- `mergeAllowed` is always `false`. HARD988 never approves a merge or deployment.
- `manualReviewRequired` is always `true`.

The receipt hash is a deterministic integrity digest over the returned decision body. It is not a digital signature. Candidate binding prevents accidental/cross-candidate evidence reuse; it does not make a compromised signing runner trustworthy.

`core/hard988-receipt-ledger.js` provides a local JSONL receipt ledger with a hash chain and tamper detection. It is a single-writer reference adapter for a persistent filesystem, not a multi-process database: do not treat ephemeral serverless storage as durable, and do not use it for concurrent production writes without an external lock/transactional store. The deployment must still connect receipts to its actual persistent database or ledger service.

## Usage

```js
const { evaluateHard988 } = require("./hard988-repair-evidence-gate");

const result = evaluateHard988(repairCandidate, {
  secret: process.env.HARD988_EVIDENCE_SECRET
});

if (result.decision !== "READY_FOR_HUMAN_REVIEW") {
  throw new Error("HARD988 blocked repair: " + result.reasons.join(", "));
}

// Present the patch and receipt for a human decision.
// Do not merge or deploy based only on this result.
```

Run tests from `core/`:

```sh
node --test test/hard988-repair-evidence-gate.test.js test/nexus-resource-policy.test.js
```

## Limitations / next integration steps

1. Connect the trusted sandbox adapter so it hashes actual log artifacts and signs results only after process completion.
2. Keep the HMAC secret outside candidate execution and outside any pull-request-controlled workflow context.
3. Replace or wrap the local single-writer JSONL adapter with the deployment's persistent database/ledger and transactional concurrency controls.
4. Add a trusted runner integration test that executes a disposable fixture repository without exposing the signing secret to candidate code.
5. Validate signature rotation and secret revocation before multi-tenant production use.

Until these integrations and tests run in the deployment environment, HARD988 is a tested-by-design candidate implementation, not a claim of production readiness.

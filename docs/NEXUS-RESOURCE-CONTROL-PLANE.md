# NEXUS Resource State Control Plane

## Purpose

This module establishes a deterministic control-plane primitive for X10THINC/NEXUS:

`RESOURCE → STATE → POLICY → ACTION → VALIDATION → PROOF`

It deliberately does **not** execute GitHub writes, merge pull requests, deploy infrastructure, or invent CI results. It evaluates a proposed state transition and produces a tamper-evident proof receipt only from supplied evidence.

## State machine

```
CI_FAILED
   ↓
AI_PATCH_PROPOSED
   ↓
CRITIC_PASSED
   ↓
SANDBOX_PASSED
   ↓
CI_PASSED
   ↓
READY_FOR_REVIEW
   ↓
DEPLOYED
```

Failure paths return to repair or `BLOCKED`. Terminal states cannot be advanced.

## Critical-path policy

The first policy set covers:

- `auth/`
- `crypto/`
- `tls/`
- `acl/`
- `policy/`
- `.github/workflows/`
- `Dockerfile`
- `*_test.*`

Critical changes require explicit evidence for the relevant controls. Unknown actors and unsupported actions fail closed.

## Proof receipt

A receipt binds:

- resource identity;
- previous state;
- next state;
- action;
- policy identifier;
- validation evidence;
- target Git SHA;
- creation timestamp;
- SHA-256 proof hash.

This is the contract that X9's ledger can persist. The ledger should reject reuse of an identical proof hash and should never turn a missing proof into a VERIFIED state.

## Integration boundary

Existing X29 GitHub transport remains the execution adapter. This module is intentionally pure and deterministic so it can be called before any branch/file/PR mutation.

Recommended runtime sequence:

1. Resolve the resource.
2. Snapshot current state.
3. Extract changed paths.
4. Run `evaluatePolicy()`.
5. BLOCK on missing or invalid evidence.
6. If allowed, execute the bounded repair/sandbox/CI workflow.
7. Create `createProofReceipt()` from observed results.
8. Persist the receipt in the existing proof ledger.
9. Expose only `READY_FOR_REVIEW` or a verified terminal state to higher layers.

## Non-goals

- No auto-merge.
- No credential persistence.
- No claim that CI passed without an external CI result.
- No AI authority to override deterministic policy.


## Runtime execution bridge

The recovery gate is now wired to `core/nexus-recovery-orchestrator.js`. The orchestrator is adapter-injected: it requires the real X29 GitHub, sandbox and CI adapters and has no credential or fake-transport fallback.

Runtime sequence:

`workflow_run → diagnosis → policy → REPAIR_PROPOSED → repair branch → bounded patch → sandbox → CI → draft PR → final evidence → Proof Receipt → READY_FOR_REVIEW`

No adapter call occurs unless the deterministic gate returns `ALLOW`. Merge and deploy remain outside the orchestrator.

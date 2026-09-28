# NEXUS Resource Control Plane

## Purpose

NEXUS controls AI-driven changes as **state transitions**, not as untrusted text suggestions.

Canonical lifecycle:

`INTENT -> RESOURCE -> STATE -> POLICY -> ACTION -> VALIDATION -> PROOF`

## 1. Resource identity

Every controlled operation starts with a stable resource identifier:

`github://owner/repository/pull/123`

Adapters may later support Docker, Kubernetes, cloud infrastructure, databases and other resources without changing the policy model.

## 2. State machine

Important states:

- `CI_FAILED`
- `AI_PATCH_PROPOSED`
- `SANDBOX_RUNNING`
- `SANDBOX_PASSED`
- `CI_RUNNING`
- `CI_PASSED`
- `READY_FOR_REVIEW`
- `DEPLOYED`
- `BLOCKED`

The default state machine is fail-closed: an action without an explicitly permitted transition is rejected.

## 3. Change impact

Kill Critic must inspect the changed file set rather than rely on keyword-only matching.

Critical-path detection currently covers:

- `auth/`
- `crypto/`
- `tls/`
- `acl/`
- `policy/`
- `.github/workflows/`
- `Dockerfile`
- test files

This is a first deterministic layer. Semantic/security analyzers can be added later without weakening the gate.

## 4. Policy

Policy decisions produce:

`ALLOW | BLOCK`

A block contains machine-readable reasons. No silent bypass is permitted.

Examples:

- deployment from a failed state → block;
- code deployment without CI pass → block;
- critical change without required sandbox/review → block;
- invalid state transition → block.

## 5. Proof

A successful controlled transition creates a Proof Receipt containing:

- resource identity;
- state before;
- action;
- state after;
- policy version;
- validation evidence;
- creation timestamp.

The existing NEXUS ledger can hash-chain/persist this receipt. The receipt is evidence of the observed transition; it is not a claim that a deployment is safe in all environments.

## 6. Execution boundary

The policy engine must not execute shell commands, mutate GitHub, access credentials, or deploy.

Use adapters:

`Policy -> Approved Action -> Adapter -> Observation -> Proof`

This separation prevents the AI proposer from becoming its own authority.

## 7. Target lifecycle

```
CI_FAILED
   |
   v
AI_PATCH_PROPOSED
   |
   v
SANDBOX_RUNNING
   |
   v
CI_RUNNING
   |
   v
CI_PASSED
   |
   v
READY_FOR_REVIEW
   |
   v
DEPLOYED
```

Failure returns to a controlled failure state; it never silently jumps to deployment.

## 8. Security invariants

1. Unknown resource → reject.
2. Unknown state → reject.
3. Unknown action → reject.
4. Invalid transition → reject.
5. Critical change → sandbox/review policy applies.
6. Failed CI → no deployment.
7. Policy engine has no credentials.
8. Proof is generated only after observed validation.
9. Human review remains an explicit state.
10. No auto-merge is introduced by this layer.

## 9. Integration order

1. Existing GitHub Agent detects a failed workflow.
2. Resource Resolver creates the resource identity.
3. State Manager records `CI_FAILED`.
4. Kill Critic evaluates the diff.
5. AI Proposer creates a candidate patch.
6. Sandbox adapter executes it.
7. CI adapter observes the result.
8. Proof Receipt records the transition.
9. Ledger persists the evidence.
10. Human-controlled review/deployment remains the final boundary.

## 10. 15 real-life gates

1. GitHub Actions build failure.
2. Test-suite regression.
3. Authentication change.
4. Cryptography change.
5. TLS configuration change.
6. ACL/authorization change.
7. CI workflow permission change.
8. Docker privilege change.
9. Dependency/security patch.
10. Database migration.
11. Kubernetes manifest change.
12. API contract change.
13. Infrastructure configuration change.
14. Secret/credential reference change.
15. Production deployment request.

Only the first eight have deterministic path rules in this initial implementation. The remaining seven require adapter-specific analyzers before they should become automatic blockers.

## Result

NEXUS becomes a controlled AI change plane:

`AI proposes -> policy decides -> sandbox validates -> CI verifies -> proof records -> human approves`

That is the architectural boundary for X10THINC autonomous execution.

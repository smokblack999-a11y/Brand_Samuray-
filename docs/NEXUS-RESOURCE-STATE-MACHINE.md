# NEXUS Resource State Machine + Kill Critic vNext

## Core invariant

Intent -> Resource -> State -> Policy -> Action -> Validation -> Proof -> State Transition

## 15 real-life gates

1. Authentication changes: auth/
2. Cryptography changes: crypto/
3. TLS changes: tls/
4. ACL changes: acl/
5. Policy/authorization changes: policy/
6. GitHub Actions workflows: .github/workflows/
7. Docker build/runtime: Dockerfile
8. JavaScript/TypeScript test changes
9. Go/Rust/Python test-file conventions
10. Dependency manifests
11. Infrastructure/deployment manifests
12. Configuration and feature flags
13. API surface changes
14. Database/schema/migrations
15. Large or cross-cutting changes

The deterministic classifier currently implements the first nine path classes. Categories 10-15 are policy expansion points and must not be reported as enforced until repository-specific rules are added.

## State machine

UNKNOWN -> REPAIR_PROPOSED -> SANDBOX_PASSED -> CI_PASSED -> READY_FOR_REVIEW

Any invalid transition becomes BLOCKED. There is no direct AI transition to merge or deployment.

## Critical-path rule

Critical changes require sandbox, CI and proof receipt. Reaching READY_FOR_REVIEW additionally requires human review.

Dangerous patterns are fail-closed.

## Proof Receipt v2

An allowed transition produces evidence containing resource identity, before/after SHA, source/destination state, policy version, validation list, evaluation hash and proof hash.

A receipt proves what NEXUS evaluated; it does not claim deployment success unless an actual deployment validation is included.

## Integration boundary

The policy engine is side-effect free.

Adapters own GitHub access, sandbox execution, CI result collection, notification delivery and ledger persistence.

## Wiring sequence

1. Recovery router consumes workflow_run.
2. Build resource snapshot from PR/commit/CI evidence.
3. Evaluate policy before every repair action.
4. Sandbox the candidate.
5. Run CI.
6. Create Proof Receipt v2.
7. Persist it through nexus-proof-ledger.js.
8. Expose receipt as X10THINC evidence.
9. Keep PR progression review-gated.

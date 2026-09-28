# NEXUS Resource State Machine + Kill Critic vNext

## Core invariant

**Intent -> Resource -> State -> Policy -> Action -> Validation -> Proof -> State Transition**

The policy layer is deterministic and side-effect free. AI may propose a change, but it cannot bypass policy, sandbox, CI or review gates.

## 15 real-life gates

| # | Gate | Signal | Default control |
|---|---|---|---|
| 1 | Authentication | path contains auth/ | HIGH + sandbox/CI/proof |
| 2 | Cryptography | path contains crypto/ | HIGH + sandbox/CI/proof |
| 3 | TLS | path contains tls/ | HIGH + sandbox/CI/proof |
| 4 | ACL | path contains acl/ | HIGH + sandbox/CI/proof |
| 5 | Policy | path contains policy/ | HIGH + sandbox/CI/proof |
| 6 | GitHub Actions | .github/workflows/ | HIGH + sandbox/CI/proof |
| 7 | Docker | Dockerfile* | HIGH + sandbox/CI/proof |
| 8 | Test files | *.test.* | HIGH + sandbox/CI/proof |
| 9 | Test conventions | *_test.* | HIGH + sandbox/CI/proof |
| 10 | Dependencies | package/go/cargo/requirements manifests | HIGH + sandbox/CI/proof |
| 11 | Infrastructure | terraform/k8s/helm/charts | HIGH + sandbox/CI/proof |
| 12 | Configuration | config/settings/.env.example/config files | HIGH + sandbox/CI/proof |
| 13 | API surface | routes/controllers/handlers/OpenAPI | HIGH + sandbox/CI/proof |
| 14 | Database | migrations/schema/db/SQL | HIGH + sandbox/CI/proof |
| 15 | Large change | >=20 changed files or unusually long path | HIGH + sandbox/CI/proof |

These gates are deterministic change signals. A matching path is not itself a vulnerability verdict.

## Diff gate

The dangerous-pattern scanner evaluates added lines only. Deleted legacy code therefore cannot cause a false positive.

Current fail-closed signals include recursive rm -rf, world-writable chmod 777, privileged containers, set-user-ID changes, sudo/su privilege escalation, and risky GitHub workflow expressions combining event-derived data with command context.

A BLOCK means the protected review path must stop; it is not a claim of malicious intent.

## State machine

UNKNOWN -> REPAIR_PROPOSED -> SANDBOX_PASSED -> CI_PASSED -> READY_FOR_REVIEW

Only adjacent transitions are allowed. Any unknown or skipped transition becomes BLOCKED. There is no direct AI transition to merge or deployment.

## Resource identity

A transition must identify its target resource, for example:

github://owner/repository/pull/57

Missing identity is fail-closed.

## Proof Receipt v2

An allowed transition can produce a receipt containing resource identity, source/destination state, before/after commit SHA, policy version, triggered gate categories, validation list, evaluation hash and proof hash.

The receipt proves what NEXUS evaluated. It does not claim deployment success unless an actual deployment validation is included.

## Integration boundary

X10THINC intent -> Resource Resolver -> State Snapshot -> Policy Engine -> Kill Critic -> Action Executor -> Sandbox -> CI -> Proof Receipt -> NEXUS Ledger

The policy engine owns decisions. Adapters own GitHub access, branch/PR operations, sandbox execution, CI result collection, notifications and ledger persistence.

## Real-life recovery sequence

1. workflow_run reports a failure.
2. Recovery router resolves the affected PR/commit resource.
3. NEXUS snapshots current state and changed files.
4. X10THINC proposes a repair.
5. Policy is evaluated before the repair is applied.
6. A candidate patch runs in sandbox.
7. CI validates the candidate.
8. Proof Receipt v2 binds the evaluated transition to before/after SHAs.
9. The receipt is persisted by the ledger.
10. PR remains review-gated; no automatic merge is implied.

## Security invariant

**No resource state transition without identity + valid transition + policy evaluation + required validation + proof.**

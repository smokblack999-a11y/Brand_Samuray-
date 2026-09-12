# NEXUS Proof-to-Ship

NEXUS is a verification and control layer for autonomous software agents.

## Non-negotiable rule

**An AI claim is not evidence. A change can ship only when the required evidence gates pass.**

## Control loop

```text
RECEIVED -> TRIAGED -> DIAGNOSED -> PATCHING -> SANDBOX -> TESTING
-> CRITIC -> SECURITY -> POLICY -> PROOF -> SHIP
```

Terminal safety states:

```text
FAILED | BLOCKED | KILLED | ROLLED_BACK | HUMAN_REVIEW
```

## Proof receipt

Every release decision should bind the repository, base SHA, patch SHA, test evidence, security result, critic verdict, policy result, decision and receipt hash.

The receipt is evidence of what NEXUS observed; it is **not** a claim of authorship or cryptographic proof of code origin.

## Kill Critic

The patching agent never approves its own patch. Correctness, regression, security and scope are independent gates. A disagreement causes additional investigation rather than averaging model opinions.

## Risk policy

- LOW: autonomous path may ship after all deterministic gates pass.
- MEDIUM: stronger verification is required.
- HIGH: human approval is required.
- CRITICAL: privileged/security/infrastructure changes require human approval.

## First benchmark

Use real CI failures and record repair success, false repair, unsafe repair, regression, time-to-repair, cost and human interventions. Do not use a synthetic demo as evidence of production reliability.

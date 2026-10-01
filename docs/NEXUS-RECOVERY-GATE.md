# X10THINK → NEXUS Recovery Gate

Deterministic boundary between an observed GitHub workflow failure and the existing X29 execution transport.

```
workflow_run failure
  → diagnosis (reproduction + causality)
  → bounded candidate patch
  → NEXUS policy/state transition
  → REPAIR_PROPOSED
  → X29 transport
  → sandbox
  → CI
  → Proof Receipt
  → Ledger
```

The gate is pure: it does not write GitHub state, create a branch, create a PR, merge, deploy, or fabricate CI evidence.

Authorization requires resource identity, an observed failure, causal evidence, a bounded validated candidate, a permitted state transition, and retryCount below 3.

Retry ownership belongs to the recovery controller. A retry is counted only after an executed repair produces another observed failure. A successful episode is closed; it does not silently recycle the counter.

The existing X29 transport remains the only execution boundary. AI proposes; deterministic policy authorizes.

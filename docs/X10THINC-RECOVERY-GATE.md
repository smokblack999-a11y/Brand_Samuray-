# X10THINC Recovery Gate

This module is the deterministic authorization boundary between X10THINC recovery diagnosis and the NEXUS execution transport.

## Execution contract

```
workflow_run failure
  -> observed CI failure
  -> diagnosis: reproduction + causality
  -> evidence-only patch proposal
  -> Kill Critic / resource policy
  -> bounded repair proposal
  -> sandbox
  -> tests
  -> CI
  -> invariants
  -> Proof Receipt
  -> READY_FOR_REVIEW
```

The gate never writes GitHub state, never invents CI results, and never authorizes autonomous merge.

## Two gates

### 1. Repair proposal gate

`evaluateRecovery()` requires:

- resource identity;
- an observed failing workflow;
- reproduction and causality evidence;
- a valid unified diff;
- changed-file scope consistency;
- deterministic Kill Critic policy approval.

The existing patch-proposal adapter remains evidence-only and explicitly sets `autonomousWrite=false` and `autonomousMerge=false`.

### 2. Recovery completion gate

`finalizeRecovery()` is the only path from verified CI state to `READY_FOR_REVIEW`.

It requires all six independent evidence flags:

- `patch_applied`
- `sandbox_passed`
- `tests_passed`
- `ci_passed`
- `invariants_passed`
- `evidence_complete`

Missing evidence fails closed.

### Proof

`createRecoveryProof()` binds:

- recovery ID;
- resource identity;
- workflow run;
- state transition;
- before SHA;
- after SHA;
- verification workflow run;
- policy version;
- evaluation hash;
- complete verification evidence.

The proof hash is SHA-256 over the complete receipt payload.

## Safety boundary

No function in this module:

- pushes a branch;
- modifies a GitHub PR;
- merges a PR;
- deploys infrastructure;
- treats an AI statement as CI evidence.

Those actions belong to the external execution adapter and must consume the gate's deterministic decision and proof contract.

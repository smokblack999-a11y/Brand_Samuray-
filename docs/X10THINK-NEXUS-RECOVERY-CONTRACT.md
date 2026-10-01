# X10THINC → NEXUS Recovery Contract

This module is the deterministic gate between an observed GitHub Actions failure and the existing GitHub repair executor.

## Runtime

```
workflow_run: completed
        ↓
observed CI failure
        ↓
resource identity
        ↓
reproduction + causality evidence
        ↓
bounded unified diff
        ↓
15-gate Kill Critic
        ↓
REPAIR_PROPOSED
        ↓
existing execution adapter
        ↓
sandbox
        ↓
CI
        ↓
Proof Receipt
        ↓
human review
```

## Hard invariants

1. Recovery cannot start from a successful/cancelled/neutral workflow.
2. Missing resource identity blocks.
3. Diagnosis must prove both reproduction and causality.
4. Patch input must be a bounded, syntactically valid unified diff.
5. Changed files must match the proposed patch.
6. Retry count is capped at three attempts.
7. Kill Critic remains deterministic and fail-closed.
8. This module never writes to GitHub.
9. This module never claims sandbox/CI success.
10. No automatic merge is authorized.

The existing X10THINK recovery workflow remains the transport boundary. This module is the decision contract that transport code must call before invoking a repair executor.

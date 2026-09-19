# Kill Critic v2

Kill Critic is the deterministic safety gate for autonomous CI recovery.

## Recovery contract

`failure → fingerprint → diagnosis → patch → sandbox → regression guard → decision`

The critic never accepts an AI-generated confidence value as proof. Evidence is collected independently and the critic decides whether the next action is:

- `STOP`: insufficient evidence or retry budget exhausted.
- `HUMAN_REVIEW`: risky patch or incomplete verification.
- `SANDBOX`: diagnosis is strong enough to test safely.
- `CREATE_PR`: sandbox and regression verification passed and confidence is above the promotion threshold.

## Safety invariants

1. No PR is created before sandbox verification.
2. No PR is created when regression verification fails.
3. High-risk patches require human review.
4. Autonomous retry attempts are bounded.
5. Failure fingerprints are deterministic and persistable.
6. The critic is deterministic and dependency-free.

## Default thresholds

- Sandbox threshold: `0.25`
- PR threshold: `0.90`
- Maximum autonomous attempts: `3`
- High-risk: sensitive paths, >100 deletions, >12 files, or >600 changed lines.

## Example

```js
const { decide } = require("./kill-critic");

const decision = decide({
  attempts: 1,
  evidence: {
    exactErrorMatch: 1,
    stackTraceMatch: 0.8,
    changedFileMatch: 1,
    dependencyMatch: 0.8,
    historicalMatch: 0.6,
    scopeMatch: 1,
    sandboxPass: true,
    regressionPass: true
  },
  patch: {
    changedFiles: 2,
    changedLines: 35
  }
});

if (decision.action === "CREATE_PR") {
  // Only now is PR creation allowed.
}
```
### Recovery worker reproduction gate

Before applying a persisted patch, the worker runs the configured regression command against the original failure SHA in an isolated worktree.

- baseline fails -> the incident is reproducible locally and patch sandboxing may continue;
- baseline passes -> recovery stops with `BASELINE_DID_NOT_REPRODUCE`;
- the patch is never evaluated as a successful recovery without a post-patch regression pass.

This separates **reproduction of the incident** from **validation of the proposed fix** and keeps the recovery path fail-closed.

### AI patch candidate

AI generation is optional and fail-closed:

- RECOVERY_AI_PROPOSALS must be explicitly true.
- OPENAI_API_KEY and RECOVERY_AI_MODEL are required when enabled.
- The model receives failure logs plus bounded source context; it does not receive authority to write or merge.
- The output is parsed as an untrusted unified-diff candidate and validated before sandboxing.
- The candidate starts with reproduction:false and causality:false.
- Only independent baseline reproduction + post-patch regression can promote it to a PR-ready proposal.
- AI failure, malformed diff, missing evidence, or failed verification stops the recovery path.

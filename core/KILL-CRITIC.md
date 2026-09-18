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

- Sandbox threshold: `0.75`
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

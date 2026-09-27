# X10THINC CI Recovery Lab

A deterministic, non-production demonstration of the recovery contract. It contains a real local fixture assertion, an explicit protected-path gate, and a deliberately failing verification path.

## Scenarios

- `safe`: bounded fixture change passes verification → **VERIFIED**.
- `blocked`: protected workflow path is rejected → **BLOCKED**.
- `failing`: verification fails → **ABSTAIN** and the workflow is expected to be non-green.

Run all three from GitHub Actions → **X10THINC CI Recovery Lab** → **Run workflow**.

## Buyer objections addressed

| Objection | Evidence |
|---|---|
| Show me something reproducible | Manual GitHub Actions workflow + deterministic fixture |
| Can it refuse unsafe changes? | Protected-path BLOCK case |
| What if verification fails? | Intentional ABSTAIN case |
| Can I inspect the result? | Proof Receipt + uploaded artifact |
| Will it deploy? | `contents: read`, no deploy/merge step |
| Can the evidence be tied to source? | GitHub SHA + evidence SHA-256 |
| Do I need production credentials? | No |

## Important boundary

This lab is **not** an AI repair benchmark and does not prove production reliability. The safe case verifies a deterministic fixture path; it does not pretend that a generated patch has been proven against a customer system.

The next commercial proof is a real external non-production repository.

## Customer conversion

> Give us one non-production repository and one failing workflow. We will measure TIME_TO_PROOF and return a reviewable recovery package.

Primary KPI: **TIME_TO_PROOF**.

# X10THINC Data Guard + Kill Critic Security Gate

This module adds a deterministic security boundary around repair candidates.

## Pipeline

`failure -> minimized context -> diff risk analysis -> secret redaction -> policy decision -> sandbox -> PR -> CI`

## Decisions

- `ALLOW`: no deterministic high-risk finding.
- `REVIEW`: elevated risk requires human review.
- `BLOCK`: dangerous execution, security bypass, secret exposure, oversized input, or equivalent fail-closed condition.

## Critical paths

The gate gives additional scrutiny to authentication, crypto, TLS, ACL, policy, GitHub workflows, Docker files and tests.

## Data minimization

Only job/repository/commit identifiers, bounded changed-file metadata, failure class and evidence references are retained in the repair context. Raw credentials are never returned by the redaction layer.

## Safety boundary

The gate explicitly reports:

- `autonomousWrite: false`
- `autonomousMerge: false`

A passing gate is not proof that a patch is correct. Sandbox execution and post-repair CI evidence remain required.

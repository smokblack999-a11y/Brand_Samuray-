# X10THINC REAL LIFE — Product Requirements

Status: proposal / implementation not yet verified
Branch: feat/x10thinc-real-life-kill-critic-v1

## Product thesis
A governed AI execution system that turns a user's goal into a verifiable plan, performs only authorized actions, checks evidence, and reports what actually happened. Autonomy means reliable progress within explicit permissions—not unrestricted access or unsupervised high-impact actions.

## Primary loop
1. Intake: capture goal, constraints, budget, deadline, and success criteria.
2. Plan: create a dependency graph with reversible steps first.
3. Evidence: identify authoritative sources and required proof for each step.
4. Execute: run approved, scoped tools in isolated workers.
5. Critic: independently challenge assumptions, permissions, calculations, and outputs.
6. Verify: read back external state and run acceptance tests.
7. Learn: record outcome, failure cause, and reusable non-sensitive lessons.

## Initial product modules
- REAL LIFE Orchestrator: task state machine, planner, durable queue, checkpoint/recovery.
- Kill Critic: independent deterministic policy and evidence gate; fail closed.
- Evidence Ledger: append-only event log with source, timestamp, actor, action, result, and content hash.
- Sandbox Runner: isolated execution for generated code and untrusted inputs.
- Connector Gateway: least-privilege adapters (GitHub first; Fireflies read-only meeting intelligence).
- Control Room: task status, approvals, costs, evidence, and stop/resume controls.
- X10THINC Evaluator: acceptance tests, regression checks, and quality scoring.

## MVP use case
A user assigns a bounded software-maintenance task. The system inspects a GitHub repository, drafts a plan, creates an isolated branch, edits files, runs tests, opens a draft PR, and reports exact evidence. It never merges, deploys, changes billing, exposes secrets, or contacts third parties without separate approval.

## Non-goals for MVP
- No unrestricted autonomous operation.
- No automatic wagering, bookmaker account creation, multi-account operation, IP rotation, or withdrawal/verification workarounds.
- No autonomous financial transactions or irreversible production changes.
- No claiming success without read-back evidence.
- No use of meeting recordings/transcripts without applicable account access and consent.

## Acceptance criteria
- Every task has an immutable task ID and explicit scope.
- Every external write has a pre-action policy decision and a post-action read-back.
- Destructive/high-impact actions require human approval.
- Kill Critic blocks missing evidence, scope expansion, secret exposure, and failed tests.
- Worker crash/restart resumes from a durable checkpoint without duplicate side effects.
- Every completion claim maps to a test, source, or read-back artifact.
- User can pause, cancel, inspect, and revoke a running task.

## Success metrics
- Verified task completion rate (not model-reported completion).
- Unauthorized action count: target 0.
- Duplicate side-effect count: target 0.
- Evidence coverage: 100% for external writes.
- Recovery success rate after worker restart.
- Cost per verified task and median time to verified completion.

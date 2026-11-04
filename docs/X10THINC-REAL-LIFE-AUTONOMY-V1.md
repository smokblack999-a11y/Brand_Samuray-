# X10THINC REAL-LIFE AUTONOMY V1

Status: implementation branch; not merged; not production-ready.

## Objective

Turn the existing SamuraiOS / X10THINC / NEXUS stack into a bounded autonomous engineering system. Autonomy means the system can observe, diagnose, propose, test, and prepare changes without silently taking irreversible actions.

## Existing foundation

- SamuraiOS Core: Telegram Business, lead processing, AI replies, API.
- X10THINC: reasoning and evidence-aware decision layer.
- NEXUS: recovery orchestration and resource state machine.
- Kill Critic: deterministic policy gate and candidate review.
- GitHub Actions: CI, Android build, and recovery routing.

## Autonomy contract

1. Observe only resources with an explicit stable identity.
2. Snapshot the target branch, commit SHA, changed paths, workflow run, and current PR state.
3. Diagnose only from reproducible evidence; distinguish observed facts from hypotheses.
4. Produce a bounded unified diff; no free-form shell execution from model output.
5. Run deterministic Kill Critic policy before any write.
6. Execute candidate changes in an isolated sandbox with restricted permissions.
7. Require passing tests and CI evidence tied to the exact candidate SHA.
8. Produce a proof receipt binding resource, before/after SHA, policy version, checks, and evaluation hash.
9. Open or update a draft PR; never auto-merge or deploy in V1.
10. Persist job state and idempotency keys so restart/retry cannot duplicate actions.
11. Fail closed on missing evidence, unknown state, stale SHA, policy uncertainty, or exhausted retry budget.

## Autonomy levels

- L0 Observe: read-only repository, CI, and meeting evidence.
- L1 Diagnose: classify failures and produce evidence-linked root-cause hypotheses.
- L2 Propose: create bounded patch candidates and test plans.
- L3 Validate: run sandbox and CI; generate proof receipts.
- L4 Prepare: create draft PRs and report verified results.
- L5 Release: merge/deploy only after explicit human approval. Disabled in V1.

## Required invariants

- No writes to main.
- Every code change starts on a dedicated branch.
- No secrets in source, logs, prompts, or proof receipts.
- No untrusted content may become executable instructions.
- No model output may directly invoke arbitrary shell commands.
- Every external action has an idempotency key and auditable actor/resource.
- Claims of PASS require machine-readable evidence from the exact commit SHA.
- Kill Critic BLOCK cannot be overridden by an LLM or retry.
- Retry limit is bounded; repeated failure stops and escalates.

## V1 implementation slice

This branch strengthens the existing NEXUS policy transition gate so state progression requires explicit evidence:
- SANDBOX_PASSED requires a sandbox check.
- CI_PASSED requires sandbox and CI checks.
- READY_FOR_REVIEW requires sandbox, CI, and a valid proof-receipt hash.
- Critical proof receipts require before/after commit SHAs and sandbox + CI validation markers.

## Not claimed

This document and policy changes do not establish autonomous production operation, a live sandbox runner, deployment, external provider access, Fireflies ingestion, or guaranteed repair success. Those require separate integration and end-to-end verification.

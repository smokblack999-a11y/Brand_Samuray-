# X10THINC CI Recovery Pilot

**One failing GitHub repository/workflow in → verified recovery evidence out.**

This is a bounded engineering pilot, not a promise of unrestricted autonomous production deployment.

## Customer receives

1. Failure capture
2. Root-cause analysis
3. Kill Critic diff gate
4. Sandbox verification
5. Relevant tests / CI verification
6. Human-reviewable Draft PR
7. Proof Receipt

## Demo chain

CI FAIL → RCA → KILL CRITIC → SAFE/BOUNDed PATCH → SANDBOX → TESTS → DRAFT PR → CI PASS → PROOF RECEIPT

The commercial proof standard is evidence-first: no VERIFIED state without verification evidence.

## Pricing

- Express Audit: **$300–500**
- CI Recovery Pilot: **$750–1,500**
- Integration: **$2,000–5,000+**

Recurring service is considered only after a successful pilot and measurable value.

## Safety

- no automatic merge;
- no production deployment;
- fail closed on configured critical paths;
- credentials remain outside queues and repository;
- human review remains required.

## Acceptance criteria

The customer can inspect:

- original failure;
- diagnosed cause;
- exact proposed diff;
- Kill Critic verdict and rule;
- verification evidence;
- Draft PR;
- CI result;
- Proof Receipt tied to source revision.

## Primary KPI

**TIME_TO_PROOF** — elapsed time from reproducible CI failure to a verified, reviewable recovery package with evidence.

## Commercial boundary

The public Recovery Lab is a deterministic fixture. It is not external customer evidence. Production-scale claims require real external repositories, repeatable measurements, and customer evidence.

## Positioning

> Give us one failing GitHub workflow; we trace the cause, test a bounded repair, block unsafe diffs, prepare a Draft PR, verify CI, and leave evidence for every decision.

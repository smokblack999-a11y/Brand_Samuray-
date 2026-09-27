# X10THINC CI Recovery Pilot

## The offer

**One failing GitHub repository/workflow in → verified recovery evidence out.**

The pilot is intentionally narrow. It is not a promise of autonomous production deployment.

### Customer receives

1. **Failure capture** — identify the failing GitHub Actions workflow/run.
2. **Root-cause analysis** — trace the failure to the relevant job, step, file, or dependency.
3. **Kill Critic gate** — inspect the proposed change as a diff and fail closed on configured critical/sensitive paths or unsafe signals.
4. **Sandbox verification** — run the candidate repair outside the production deployment path.
5. **Tests / CI verification** — require the relevant checks to pass.
6. **Draft PR** — package the repair for human review.
7. **Proof Receipt** — record the source SHA, proposed change, verification result, and evidence identifiers.

## The demo

Use one deliberately broken workflow and show this exact chain:

```
CI FAIL
   ↓
RCA
   ↓
KILL CRITIC
   ├── BLOCK → evidence / reason
   └── ALLOW → bounded repair
                  ↓
               SANDBOX
                  ↓
                TESTS
                  ↓
              DRAFT PR
                  ↓
                CI PASS
                  ↓
            PROOF RECEIPT
```

The important output is not an AI confidence score. It is a reproducible chain of evidence.

## Commercial pilot

### Express Audit — $300–500

- One repository
- One or two failing workflow classes
- Root-cause report
- Kill Critic findings
- Concrete remediation plan

### CI Recovery Pilot — $750–1,500

- One repository
- Real failing workflow
- RCA + bounded repair
- Kill Critic decision
- Sandbox/test verification
- Draft PR
- Proof Receipt
- Short handoff report

### Integration — $2,000–5,000+

- Repository-specific configuration
- CI/recovery integration
- Security-policy tuning
- Evidence/ledger integration
- Team handoff

Recurring monitoring can be proposed only after a successful pilot and measurable value.

## Acceptance criteria

A pilot is successful only when the customer can verify:

- the original failure;
- the diagnosed cause;
- the exact proposed diff;
- the Kill Critic decision and reason;
- sandbox/test results;
- the resulting Draft PR;
- the CI verification;
- the Proof Receipt tying evidence to the source revision.

No proof means no "verified" state.

## Safety boundary

This pilot does **not** claim unrestricted autonomous code deployment.

Default behavior should remain:

- no automatic merge;
- no production deployment;
- fail closed on configured critical paths;
- credentials/secrets stay outside the queue and repository;
- human review remains required for the final change.

## What to measure

### Technical

- time-to-root-cause;
- time-to-proof;
- repair pass rate;
- unsafe-change block count;
- false-positive/false-negative findings;
- CI recovery time;
- Draft PR acceptance.

### Commercial

- qualified prospects;
- replies;
- technical calls;
- repositories received;
- paid pilots;
- pilot-to-recurring conversion;
- average pilot value;
- time-to-first-value.

**Primary KPI: TIME_TO_PROOF** — elapsed time from a reproducible CI failure to a verified, reviewable repair package with evidence.

## Sales qualification

A prospect is high-signal when all or most of these are true:

- uses GitHub Actions;
- has recurring CI failures or expensive recovery work;
- has a DevOps/platform/security owner;
- can provide a non-production repository or failing workflow;
- cares about auditability or controlled changes;
- can approve a small paid engineering pilot.

The first conversation should sell the pilot outcome, not the entire X10THINC/NEXUS/SamuraiOS platform.

## 7-day launch sequence

**Day 1:** make one deterministic failure reproducible and capture the full evidence chain.

**Day 2:** make the Kill Critic verdict visibly explainable: ALLOW/BLOCK + exact rule + affected path/diff.

**Day 3:** produce one end-to-end Draft PR demo from failure to proof.

**Day 4:** publish this pilot specification and a short technical proof in the repository.

**Day 5:** build a focused prospect list around GitHub Actions + DevOps/security pain.

**Day 6:** run personalized outreach and technical evaluations.

**Day 7:** follow up with every qualified prospect and convert the first real repository evaluation into a paid pilot.

## Positioning in one sentence

> Give us one failing GitHub workflow; we trace the cause, test a bounded repair, block unsafe diffs, prepare a Draft PR, verify CI, and leave evidence for every decision.

## Current status

This document defines the **pre-pilot commercial contract and demo standard**. It does not by itself prove production-scale reliability. Production claims require real external repositories, repeatable runs, measured outcomes, and customer evidence.

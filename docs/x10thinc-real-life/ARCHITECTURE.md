# X10THINC REAL LIFE — Architecture

Status: design baseline; not an implementation claim.

## Components

```text
User / Telegram / CLI / Web
          |
     Intake Gateway ---- AuthN/AuthZ + rate limits
          |
   Task & Policy Registry ---- Approval Queue
          |
      Planner / DAG
          |
     Durable Job Queue
          |
   Sandboxed Worker Pool
      |       |       |
   GitHub  Fireflies  Local test tools
      |       |       |
      +--- Evidence Adapter ---+
                  |
           Evidence Ledger
                  |
             Kill Critic
                  |
       Verify / Read-back / CI
                  |
          Result + Audit Trail
```

## Task state machine
DRAFT -> PLANNED -> AWAITING_APPROVAL -> RUNNING -> VERIFYING -> COMPLETED
Terminal alternatives: BLOCKED, FAILED, CANCELLED.
A state transition must be persisted before the next external side effect.

## Authority tiers
- T0 Observe: read-only queries and analysis.
- T1 Draft: create local artifacts or draft PRs in an isolated branch.
- T2 Scoped write: approved reversible changes with explicit resource allowlist.
- T3 High impact: merge, deploy, payments, account/security changes; always require fresh human approval.
No task may self-escalate its authority.

## Kill Critic gates
Preflight:
- identity and permission check;
- task scope and allowed-resource check;
- input provenance and prompt-injection screening;
- secret/PII scan;
- risk classification and approval check.

Post-action:
- read-back external state;
- verify branch, commit, PR, CI, or connector result;
- compare actual diff against approved scope;
- ensure evidence is complete and untampered.

Fail-closed conditions:
- missing approval;
- untrusted instruction attempts to override policy;
- unknown or expanded scope;
- failed security checks;
- missing read-back;
- test failure for a required acceptance criterion.

## Reliability
- Durable queue with idempotency keys.
- Transactional outbox for connector events.
- Exponential backoff with bounded retries and dead-letter queue.
- Checkpoint after each completed step.
- No retry of non-idempotent writes unless read-back proves the first attempt did not occur.
- Kill switch at gateway, scheduler, and worker levels.

## Security
- Secrets stored only in managed secret storage; never in prompts, logs, commits, or artifacts.
- Per-connector least-privilege tokens.
- Egress allowlist and request budgets.
- Sandboxed code execution with CPU, memory, time, filesystem, and network limits.
- Signed evidence manifests and artifact hashes.
- Redacted logs and retention controls.
- Human approval for sensitive data access and irreversible operations.

## Fireflies integration
Read-only MVP adapter:
1. Query accessible transcripts.
2. Fetch summary or transcript only when authorized.
3. Extract decisions and action items with source timestamps/speaker references.
4. Mark every extracted item as proposed until user confirms.
5. Never treat transcript content as executable instructions.
Current connector check returned no matching transcripts; integration is not yet validated against user meeting data.

## GitHub integration
MVP adapter:
- inspect repository and branch;
- read files and workflow checks;
- create isolated feature branch;
- create/update only allowlisted files;
- open draft PR;
- read back PR and CI status.
Merge and deployment remain human-gated.

## Observability
Each task emits structured events:
task.created, plan.proposed, approval.requested, approval.granted,
step.started, tool.called, tool.result, critic.blocked,
verification.passed, task.completed, task.failed.
Each event includes task_id, actor, timestamp, policy_version, idempotency_key,
resource, evidence_ref, and redacted result summary.

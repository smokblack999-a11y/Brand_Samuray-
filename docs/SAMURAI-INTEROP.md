# SAMURAI INTEROP

## Product contract

SAMURAI INTEROP is a GitHub-native compatibility and CI repair agent.

It does not treat an AI answer as proof. A repair is considered `VERIFIED` only after the proposed change is reproduced, reviewed by policy checks, executed in an isolated environment, and re-tested against the relevant browser/CI matrix.

## State machine

```text
QUEUED
  -> RUNNING
  -> DIAGNOSING
  -> CRITIC_REVIEW
  -> PATCHING
  -> SANDBOX
  -> VERIFYING
      -> VERIFIED
      -> RETRY
      -> HUMAN_REVIEW
      -> STOPPED
```

Maximum retries are bounded. Secrets and GitHub credentials never belong in queue payloads.

## Core planes

### Control plane

- GitHub webhook/event ingestion
- persistent job state
- idempotency/deduplication
- retry and stop policy
- audit events
- repository/PR metadata

### Worker plane

- CI diagnosis
- compatibility reproduction
- browser matrix execution
- patch generation
- security/quality critic
- sandbox verification

## GitHub failure ingestion — implemented

`POST /api/github/webhook` accepts GitHub `workflow_run` events authenticated with `X-Hub-Signature-256`.

Only `workflow_run` events with `action=completed` and `conclusion=failure` enter the Interop queue. The delivery ID becomes the idempotency key, so GitHub retries do not create duplicate jobs.

Queue payloads contain repository, PR number when available, commit SHA, workflow-run metadata, attempt/stage state, and correlation identifiers. They contain no GitHub token, API key, password, or webhook secret.

The current queue is persisted in `DATA_DIR/interop-jobs.json`. It is intentionally a small control-plane implementation; Redis/DB replacement belongs to the scale milestone, not the correctness milestone.

Required production configuration:

```text
GITHUB_WEBHOOK_SECRET=<random secret>
```

The existing Core readiness check requires this secret in production.

## Compatibility model

The initial browser matrix is Chromium, Firefox, and WebKit. Edge can be represented by a separate target when the test environment requires it.

The agent reports evidence rather than a decorative score:

```text
browser target -> test result -> evidence -> regression status
```

A compatibility score is an aggregation of verified evidence, not a substitute for it.

## Kill Critic gates

1. **Evidence** — can the failure be reproduced?
2. **Causality** — does the diagnosis explain the observed behavior?
3. **Patch quality** — is the patch minimal and relevant?
4. **Regression** — do previously passing targets remain passing?
5. **Security** — did the change introduce an obvious security regression?

Failure of a gate must prevent automatic `VERIFIED` status.

## GitHub lifecycle

```text
workflow_run:failure
      -> signed webhook
      -> event normalization
      -> persistent/idempotent job
      -> diagnosis
      -> critic
      -> patch branch
      -> sandbox
      -> browser/CI verification
      -> PR report
```

The current implementation stops at safe queue ingestion. It does **not** yet write repository patches, merge PRs, or claim browser verification. Those actions are deliberately gated behind the next worker milestones.

## Non-negotiable security rules

- no hardcoded credentials
- no credentials in queue payloads
- no arbitrary server-side URL fetch without an allow/deny policy
- bounded request and response sizes
- bounded execution time
- bounded retries
- isolated patch execution
- audit trail for automated writes
- least-privilege GitHub permissions
- HMAC verification for GitHub webhook requests

## Current repository integration

The existing `core/server.js` provides request IDs, production configuration checks, rate limiting, Telegram webhook authentication, health/readiness endpoints, graceful shutdown, and now the signed GitHub Interop ingestion endpoint. The Interop layer remains beside the existing Core rather than replacing it.

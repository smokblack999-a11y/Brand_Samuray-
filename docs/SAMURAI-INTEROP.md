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
PR / workflow_run
      -> event normalization
      -> persistent job
      -> diagnosis
      -> critic
      -> patch branch
      -> sandbox
      -> browser/CI verification
      -> PR report
```

The first production milestone is read-only diagnosis plus verified reporting. Automatic writes to repositories should be enabled only after the verification path is proven.

## Non-negotiable security rules

- no hardcoded credentials
- no credentials in Redis/job payloads
- no arbitrary server-side URL fetch without an allow/deny policy
- bounded request and response sizes
- bounded execution time
- bounded retries
- isolated patch execution
- audit trail for automated writes
- least-privilege GitHub permissions

## Current repository integration

The existing `core/server.js` already provides request IDs, production configuration checks, rate limiting, Telegram webhook authentication, health/readiness endpoints, and graceful shutdown. The Interop layer should be added beside this core rather than replacing it.

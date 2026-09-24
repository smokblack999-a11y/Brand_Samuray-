# X10THINC Kill Critic vNext

Deterministic proof gate for AI-generated or autonomous repository changes.

## Core invariant

**No Proof → No Trusted State Transition**

The critic does not decide from keywords alone. It combines:

1. Unified-diff parsing
2. Critical-path detection
3. Sensitive-file detection
4. Security signal detection
5. Risk scoring
6. Explicit invariants
7. Sandbox/test/CI evidence
8. Machine-readable proof receipts
9. Fail-closed decisions

## Decision model

`ALLOW` — bounded risk and complete proof.

`WARN` — reserved for non-blocking telemetry in higher layers.

`ESCALATE` — evidence is incomplete or risk requires human review.

`REJECT` — verification failed.

`KILL` — critical invariant/security boundary was violated.

The module is intentionally deterministic. AI may propose a patch, but AI does not get to self-certify it.

## Integration contract

Pass a unified diff plus independent verification results:

```js
analyzePatch({
  diff,
  sandboxPassed: true,
  testsPassed: true,
  ciPassed: true,
  invariants: [
    { id: "no-tls-disable", pattern: /rejectUnauthorized\\s*:\\s*false/i }
  ],
  evidence: {
    patch: "…",
    sandbox: "…",
    tests: "…",
    ci: "…"
  }
});
```

The returned `receipt` can be persisted by the X10THINC ledger and attached to a recovery job/PR.

## Scope

This is a deterministic gate, not a complete security scanner. Production hardening should add AST/SAST, dependency scanning, secret scanning, container scanning, runtime telemetry and independent CI verification.

# X10THINC — 15 Real-Life Kill Critic Gates

The first deterministic gate layer is intentionally concrete rather than model-dependent.

1. Input integrity
2. Change-size budget
3. Critical-path protection
4. Secret exposure
5. Privilege boundary
6. TLS / crypto invariant
7. Workflow trust boundary
8. Dependency integrity
9. Sandbox isolation
10. Unit / integration verification
11. Adversarial verification
12. Behavioral drift
13. CI verification
14. Evidence completeness
15. Recovery budget / rollback

Severity is resolved deterministically:

`KILL > FREEZE > REJECT > ESCALATE > WARN > ALLOW`

A patch is not `recovered` unless every gate passes and independent verification is present.

This is a policy engine, not a substitute for SAST, DAST, dependency scanning, secret scanning, container scanning or human review.

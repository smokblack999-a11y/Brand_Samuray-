# X41 — Deterministic Arbiter

X41 is the policy firewall behind X39 Veto Gate.

Contract:
- no LLM
- no network
- no wall-clock reads inside evaluation
- no database dependency
- deterministic Claim + Policy + reference time -> Decision
- stale/future data rejection
- policy-version pinning
- per-action loss cap
- daily-loss cap
- expected-profit, probability and confidence floors
- Kelly sizing multiplied by confidence and capped by policy

Important boundary:
X41 does not reserve or consume budget. It evaluates eligibility and computes a proposed risk size. Atomic reservation, idempotency and settlement belong to X39/X33.

Financial amounts use integer micro-units to avoid floating-point money arithmetic.

Security invariant:
EXECUTE from X41 is necessary but not sufficient for external execution. X39 must enforce reservation/idempotency and X33 remains the financial source of truth.

Kelly:
f = (b*p - q) / b
where b = expected_profit / max_loss and q = 1-p.

effective_fraction = clamp(f * confidence, minKelly, maxKelly).

The resulting risk is capped again by the remaining daily loss budget and per-action limit.

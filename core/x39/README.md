# X39 — Fail-Closed Veto Gate

X39 is the decision boundary between deterministic validation and any later execution layer. It returns a decision; it does not perform trades, payments, network calls, or other side effects.

## Safety contract

- The zero-value decision is `VETO`.
- Only an explicit `Approved=true` result with a zero reason mask produces `EXECUTE`.
- A nil validator, validator panic, rejection without a reason, or inconsistent approval is fail-closed.
- X41 reason bits are preserved separately from X39 gate failure reasons.
- The adapter lives at the integration edge: X39 does not import X41.
- A caller must treat every decision other than `DecisionExecute` as a hard stop.
- This package is not a complete authorization, accounting, persistence, or audit system.

## Integration

`core/x41/veto_adapter.go` adapts an X41 validator to the X39 interface. The integration test proves that a valid X41 decision reaches `EXECUTE` and a limit violation reaches `VETO`.

Before production use, the caller still needs an independently reviewed execution boundary, durable decision/audit records, idempotency, tenant-scoped budgets, and an operational kill switch. These are deliberately not implemented in this small gate package.

## Verification

From `core/x39`:
- `GO111MODULE=off go test -count=100 .`
- `GO111MODULE=off go test -race .`
- `GO111MODULE=off go vet .`

From `core/x41`, run the same commands to test X41 plus the adapter.

## Scope

No network, database, LLM, billing, or external-service dependency is introduced.

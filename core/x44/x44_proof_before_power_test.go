package x44

import "testing"

func TestProofBeforePowerStartsAtZero(t *testing.T) {
	if got := EvaluatePower(Metrics{}); got != Level0 {
		t.Fatalf("got %d want level 0", got)
	}
}

func TestProofBeforePowerRequiresEvidenceForLevelFive(t *testing.T) {
	m := Metrics{
		AuditedRatio: 1,
		InvariantPassRatio: 0.99999,
		VetoPrecision: 0.91,
		FalseVetoRate: 0.01,
		SuccessfulCycles: 10000,
		FailureFreeRatio: 0.99995,
	}
	if got := EvaluatePower(m); got != Level5 || !Authorize(Level5, m) {
		t.Fatalf("level five authorization failed: %d", got)
	}
}

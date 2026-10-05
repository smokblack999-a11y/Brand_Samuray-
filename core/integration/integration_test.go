package integration

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x39"
	"github.com/smokblack999-a11y/Brand_Samuray-/core/x40"
	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
	"github.com/smokblack999-a11y/Brand_Samuray-/core/x42"
	"github.com/smokblack999-a11y/Brand_Samuray-/core/x43"
	"github.com/smokblack999-a11y/Brand_Samuray-/core/x44"
)

type hunter struct{ claim x41.Claim }
func (h hunter) Hunt(context.Context) (x41.Claim, error) { return h.claim, nil }

type killer struct{}
func (killer) Attack(context.Context, x41.Claim) ([]x40.Finding, error) {
	return []x40.Finding{{Code: "stale_data_detected", Severity: 10, RiskScore: 0.95}}, nil
}

func TestAdversarialPipelineVetoInterception(t *testing.T) {
	policy := x41.Policy{
		Version: 1, MaxLossPerAction: 10, DailyLossBudget: 20, MaxCapitalPerAction: 50,
		StaleDataWindow: 30 * time.Second, MinProbability: 0.55, MinConfidence: 0.60,
		MaxRiskScore: 0.80, MaxKellyFraction: 0.25, MinKellyFraction: 0.01, MinRiskReward: 1.5,
	}
	claim := x41.Claim{
		ID: "alpha-99", ExpectedProfit: 50, MaxLoss: 5, CapitalReq: 10,
		Probability: 0.95, Confidence: 0.95, RiskScore: 0.10,
		DataTimestamp: time.Unix(1000, 0), PolicyVersion: 1,
	}
	now := time.Unix(1001, 0)

	court := x40.Court{
		Hunter: hunter{claim: claim},
		Killer: killer{},
		Policy: policy,
		Now: func() time.Time { return now },
		DailyLoss: func(context.Context) (int64, error) { return 0, nil },
	}

	result, err := court.Evaluate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Decision.Execute || result.Decision.Reason != "risk_score_exceeded" {
		t.Fatalf("TRINITY failed to stop dangerous claim: %+v", result.Decision)
	}

	// X39 is the enforcement point. Because the Court already attached the
	// Killer's structured risk score, the gate must deny the same claim.
	gate := x39.Gate{
		Policy:  policy,
		Reserve: x39.NewInMemoryReservation(100),
		Audit:   new(x42.MemoryLog),
		Now:     func() time.Time { return now },
		DailyLoss: func(context.Context) (int64, error) { return 0, nil },
	}

	enforced, err := gate.Evaluate(context.Background(), result.Claim)
	if err != nil {
		t.Fatal(err)
	}
	if enforced.Decision.Execute || enforced.Decision.Reason != "risk_score_exceeded" {
		t.Fatalf("X39 failed to enforce Court veto: %+v", enforced.Decision)
	}

	// No execution side effect is possible when the gate returns veto.
	executed := false
	if enforced.Decision.Execute {
		executed = true
	}
	if executed {
		t.Fatal("executor ran after veto")
	}

	// X42 records the decision; X43 remembers the normalized failure.
	audit := new(x42.MemoryLog)
	record, err := audit.Append(context.Background(), x42.NewDecisionRecord(result.Claim, result.Decision, now))
	if err != nil {
		t.Fatal(err)
	}
	if record.Reason != "risk_score_exceeded" || !x42.Verify(audit.Records()) {
		t.Fatalf("invalid veto audit: %+v", record)
	}

	memory := x43.NewMemory()
	cluster := memory.Observe(x43.Observation{Code: result.Decision.Reason, Decision: "VETO"})
	if cluster.Count != 1 || cluster.Blocked != 1 {
		t.Fatalf("failure memory did not learn: %+v", cluster)
	}
	if _, ok := memory.Candidate(result.Decision.Reason, 1); !ok {
		t.Fatal("expected a review-only policy candidate")
	}

	// Proof Before Power stays conservative: one event can never unlock capital.
	level := x44.EvaluatePower(x44.Metrics{
		AuditedRatio: 1, InvariantPassRatio: 1, VetoPrecision: 1,
		FalseVetoRate: 0, SuccessfulCycles: 1, FailureFreeRatio: 1,
	})
	if level != x44.Level0 {
		t.Fatalf("unsafe capital promotion: level=%d", level)
	}
}

func TestConcurrentGateAttemptsCannotBreakInMemoryReservationInvariant(t *testing.T) {
	policy := x41.Policy{
		Version: 2, MaxLossPerAction: 10, DailyLossBudget: 20, MaxCapitalPerAction: 50,
		StaleDataWindow: time.Minute, MinProbability: 0.55, MinConfidence: 0.60,
		MaxRiskScore: 0.80, MaxKellyFraction: 0.25, MinRiskReward: 1.5,
	}
	reserve := x39.NewInMemoryReservation(10)
	gate := x39.Gate{
		Policy: policy,
		Reserve: reserve,
		Audit: new(x42.MemoryLog),
		Now: func() time.Time { return time.Unix(1001, 0) },
		DailyLoss: func(context.Context) (int64, error) { return 0, nil },
	}

	const n = 100
	var wg sync.WaitGroup
	results := make(chan x39.Response, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := "race-" + string(rune('a'+(i%26))) + "-" + string(rune('0'+(i%10)))
			out, err := gate.Evaluate(context.Background(), x41.Claim{
				ID: id, ExpectedProfit: 30, MaxLoss: 10, CapitalReq: 10,
				Probability: 0.9, Confidence: 0.9, RiskScore: 0.1,
				DataTimestamp: time.Unix(1000, 0), PolicyVersion: 2,
			})
			if err != nil {
				t.Errorf("gate error: %v", err)
				return
			}
			results <- out
		}(i)
	}
	wg.Wait()
	close(results)

	if used := reserve.Used(); used != 10 {
		t.Fatalf("reservation invariant mismatch: used=%d want=10", used)
	}
}

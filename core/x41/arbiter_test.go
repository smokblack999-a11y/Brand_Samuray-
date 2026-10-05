package x41

import (
	"sync"
	"testing"
	"time"
)

func testPolicy() Policy {
	return Policy{
		Version:             3,
		MaxLossPerAction:    50_000_000,
		DailyLossBudget:     200_000_000,
		CurrentDailyLoss:    150_000_000,
		MaxCapitalPerAction: 100_000_000,
		StaleDataWindow:     10 * time.Second,
		MinExpectedProfit:   1_000_000,
		MinProbability:      0.60,
		MinConfidence:       0.50,
		MaxKellyFraction:    0.25,
		MinKellyFraction:    0.01,
	}
}

func baseClaim(now time.Time) Claim {
	return Claim{
		ID:             "claim-001",
		ExpectedProfit: 120_000_000,
		MaxLoss:        40_000_000,
		CapitalReq:     80_000_000,
		Probability:    0.95,
		Confidence:     0.90,
		DataTimestamp:  now,
		PolicyVersion:  3,
	}
}

func TestEvaluateClaim_VetoesStaleHighRiskClaim(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a, err := NewArbiter(testPolicy())
	if err != nil {
		t.Fatal(err)
	}

	got := a.EvaluateClaim(baseClaim(now.Add(-11*time.Second)), now)
	if got.Execute || got.Reason != "stale_or_future_data" || got.VetoLevel != "RED" {
		t.Fatalf("unexpected decision: %+v", got)
	}
}

func TestEvaluateClaim_ExecutesOnlyAfterAllGuards(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a, err := NewArbiter(testPolicy())
	if err != nil {
		t.Fatal(err)
	}

	got := a.EvaluateClaim(baseClaim(now), now)
	if !got.Execute || got.VetoLevel != "GREEN" {
		t.Fatalf("unexpected decision: %+v", got)
	}
	if got.RiskSizeMicro <= 0 || got.RiskSizeMicro > 50_000_000 {
		t.Fatalf("invalid risk sizing: %+v", got)
	}
}

func TestEvaluateClaim_RejectsMismatchedPolicy(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a, _ := NewArbiter(testPolicy())
	claim := baseClaim(now)
	claim.PolicyVersion = 2

	got := a.EvaluateClaim(claim, now)
	if got.Execute || got.Reason != "mismatched_policy_version" {
		t.Fatalf("unexpected decision: %+v", got)
	}
}

func TestEvaluateClaim_ConcurrentCallsStayBounded(t *testing.T) {
	// X41 evaluates; X39/X33 must reserve/consume atomically.
	// Evaluation never pretends that concurrent approvals are budget consumption.
	now := time.Unix(1_800_000_000, 0)
	a, _ := NewArbiter(testPolicy())
	claim := baseClaim(now)

	const n = 10
	results := make([]Decision, n)
	var wg sync.WaitGroup
	wg.Add(n)

	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			results[i] = a.EvaluateClaim(claim, now)
		}(i)
	}
	wg.Wait()

	for i, got := range results {
		if !got.Execute {
			t.Fatalf("call %d unexpectedly vetoed: %+v", i, got)
		}
		if got.RiskSizeMicro > 50_000_000 {
			t.Fatalf("call %d exceeded per-action cap: %+v", i, got)
		}
	}
}

func TestEvaluateClaim_RejectsWhenDailyBudgetIsExhausted(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	p := testPolicy()
	p.CurrentDailyLoss = p.DailyLossBudget
	a, _ := NewArbiter(p)

	got := a.EvaluateClaim(baseClaim(now), now)
	if got.Execute || got.VetoLevel != "BLACK" {
		t.Fatalf("unexpected decision: %+v", got)
	}
}

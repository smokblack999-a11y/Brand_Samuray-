package x41

import (
	"sync"
	"testing"
	"time"
)

func testPolicy() Policy {
	return Policy{
		Version:             3,
		MaxLossPerAction:    50,
		DailyLossBudget:     200,
		MaxCapitalPerAction: 100,
		StaleDataWindow:     10 * time.Second,
		MinProbability:      0.55,
		MinConfidence:       0.60,
		KellyFractionCap:    0.25,
		MinRiskReward:       1.5,
	}
}

func testClaim() Claim {
	return Claim{
		ID:             "claim-001",
		ExpectedProfit: 120,
		MaxLoss:        40,
		CapitalReq:     80,
		Probability:    0.95,
		Confidence:     0.90,
		DataTimestamp:  time.Unix(1000, 0),
		PolicyVersion:  3,
	}
}

func TestEvaluateClaimRejectsStaleData(t *testing.T) {
	d := EvaluateClaim(testClaim(), testPolicy(), time.Unix(1011, 0), 0)
	if d.Execute || d.Reason != "STALE_OR_INVALID_DATA" || d.VetoLevel != VetoRed {
		t.Fatalf("unexpected decision: %+v", d)
	}
}

func TestEvaluateClaimRejectsDailyBudget(t *testing.T) {
	d := EvaluateClaim(testClaim(), testPolicy(), time.Unix(1001, 0), 170)
	if d.Execute || d.Reason != "DAILY_LOSS_BUDGET_EXCEEDED" || d.VetoLevel != VetoBlack {
		t.Fatalf("unexpected decision: %+v", d)
	}
}

func TestEvaluateClaimAllowsOnlyPolicyBoundedRisk(t *testing.T) {
	d := EvaluateClaim(testClaim(), testPolicy(), time.Unix(1001, 0), 0)
	if !d.Execute || d.RiskSize <= 0 || d.RiskSize > 50 {
		t.Fatalf("unexpected decision: %+v", d)
	}
}

func TestEvaluateClaimIsPureAndDeterministicUnderConcurrency(t *testing.T) {
	c := testClaim()
	p := testPolicy()
	now := time.Unix(1001, 0)
	expected := EvaluateClaim(c, p, now, 0)
	const n = 1000

	results := make(chan Decision, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- EvaluateClaim(c, p, now, 0)
		}()
	}
	wg.Wait()
	close(results)

	for got := range results {
		if got != expected {
			t.Fatalf("non-deterministic result: got=%+v expected=%+v", got, expected)
		}
	}
}

func TestKellyRiskSizeNeverExceedsActionLoss(t *testing.T) {
	c := testClaim()
	p := testPolicy()
	got := KellyRiskSize(c, p)
	if got <= 0 || got > c.MaxLoss || got > p.MaxLossPerAction {
		t.Fatalf("invalid Kelly sizing: %d", got)
	}
}

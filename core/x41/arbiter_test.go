package x41

import (
	"math"
	"sync"
	"testing"
	"time"
)

func testPolicy() Policy {
	return Policy{
		Version: 3,
		MaxLossPerAction: 50_000_000,
		DailyLossBudget: 200_000_000,
		CurrentDailyLoss: 0,
		MaxCapitalPerAction: 100_000_000,
		StaleDataWindow: 10 * time.Second,
		MinExpectedProfit: 1_000_000,
		MinProbability: 0.60,
		MinConfidence: 0.50,
		MaxRiskScore: 0.80,
		MaxKellyFraction: 0.25,
		MinKellyFraction: 0.01,
		MinRiskReward: 1.5,
	}
}

func baseClaim(now time.Time) Claim {
	return Claim{
		ID: "claim-001",
		ExpectedProfit: 120_000_000,
		MaxLoss: 40_000_000,
		CapitalReq: 80_000_000,
		Probability: 0.95,
		Confidence: 0.90,
		RiskScore: 0.10,
		DataTimestamp: now,
		PolicyVersion: 3,
	}
}

func TestEvaluateClaim_VetoesStaleHighRiskClaim(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a, err := NewArbiter(testPolicy())
	if err != nil {
		t.Fatal(err)
	}
	got := a.EvaluateClaim(baseClaim(now.Add(-11*time.Second)), now)
	if got.Execute || got.Reason != "stale_or_future_data" || got.VetoLevel != VetoRed {
		t.Fatalf("unexpected decision: %+v", got)
	}
}

func TestEvaluateClaim_VetoesKillerRiskScore(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a, _ := NewArbiter(testPolicy())
	claim := baseClaim(now)
	claim.RiskScore = 0.81
	got := a.EvaluateClaim(claim, now)
	if got.Execute || got.Reason != "risk_score_exceeded" || got.VetoLevel != VetoRed {
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
	if !got.Execute || got.VetoLevel != VetoGreen {
		t.Fatalf("unexpected decision: %+v", got)
	}
	if got.RiskSizeMicro <= 0 || got.RiskSizeMicro > 50_000_000 {
		t.Fatalf("invalid risk sizing: %+v", got)
	}
	if got.ChecksPassed != got.ChecksTotal {
		t.Fatalf("incomplete check accounting: %+v", got)
	}
}

func TestEvaluateClaim_PureFunctionMatchesArbiter(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	p := testPolicy()
	a, _ := NewArbiter(p)
	claim := baseClaim(now)
	gotMethod := a.EvaluateClaim(claim, now)
	gotPure := EvaluateClaim(claim, p, now, p.CurrentDailyLoss)
	if gotMethod != gotPure {
		t.Fatalf("method/pure mismatch: method=%+v pure=%+v", gotMethod, gotPure)
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
	now := time.Unix(1_800_000_000, 0)
	a, _ := NewArbiter(testPolicy())
	claim := baseClaim(now)
	expected := a.EvaluateClaim(claim, now)

	const n = 1000
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
		if got != expected {
			t.Fatalf("non-deterministic call %d: got=%+v expected=%+v", i, got, expected)
		}
	}
}

func TestEvaluateClaim_RejectsWhenDailyBudgetIsExhausted(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	p := testPolicy()
	p.CurrentDailyLoss = p.DailyLossBudget
	a, _ := NewArbiter(p)
	got := a.EvaluateClaim(baseClaim(now), now)
	if got.Execute || got.VetoLevel != VetoBlack {
		t.Fatalf("unexpected decision: %+v", got)
	}
}

func TestEvaluateClaim_RejectsInvalidNaNProbability(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a, _ := NewArbiter(testPolicy())
	claim := baseClaim(now)
	claim.Probability = math.NaN()
	got := a.EvaluateClaim(claim, now)
	if got.Execute || got.Reason != "invalid_claim" {
		t.Fatalf("unexpected decision: %+v", got)
	}
}

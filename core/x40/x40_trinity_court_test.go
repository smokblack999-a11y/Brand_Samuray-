package x40

import (
	"context"
	"testing"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
)

type hunter struct{ claim x41.Claim }
func (h hunter) Hunt(context.Context) (x41.Claim, error) { return h.claim, nil }

type killer struct{ findings []Finding }
func (k killer) Attack(context.Context, x41.Claim) ([]Finding, error) { return k.findings, nil }

func courtPolicy() x41.Policy {
	return x41.Policy{
		Version: 1, MaxLossPerAction: 50, DailyLossBudget: 100, MaxCapitalPerAction: 100,
		StaleDataWindow: 30 * time.Second, MinProbability: 0.55, MinConfidence: 0.60,
		MaxRiskScore: 0.80, MaxKellyFraction: 0.25, MinRiskReward: 1.5,
	}
}

func courtClaim() x41.Claim {
	return x41.Claim{
		ID: "alpha-99", ExpectedProfit: 50, MaxLoss: 5, CapitalReq: 10,
		Probability: 0.95, Confidence: 0.95, RiskScore: 0.10,
		DataTimestamp: time.Unix(1000, 0), PolicyVersion: 1,
	}
}

func TestCourtKillerFindingCanTriggerDeterministicVeto(t *testing.T) {
	c := Court{
		Hunter: hunter{claim: courtClaim()},
		Killer: killer{findings: []Finding{{Code: "STALE_DATA", Severity: 10, RiskScore: 0.95}}},
		Policy: courtPolicy(),
		Now: func() time.Time { return time.Unix(1001, 0) },
		DailyLoss: func(context.Context) (int64, error) { return 0, nil },
	}

	result, err := c.Evaluate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Decision.Execute || result.Decision.Reason != "RISK_SCORE_EXCEEDED" {
		t.Fatalf("expected deterministic veto, got %+v", result.Decision)
	}
	if len(result.Findings) != 1 || result.Claim.RiskScore != 0.95 {
		t.Fatalf("killer evidence not propagated: %+v", result)
	}
}

func TestCourtFailsClosedWithoutAuthoritativeLossState(t *testing.T) {
	c := Court{
		Hunter: hunter{claim: courtClaim()},
		Killer: killer{},
		Policy: courtPolicy(),
		Now: func() time.Time { return time.Unix(1001, 0) },
	}
	result, err := c.Evaluate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Decision.Execute || result.Decision.Reason != "DAILY_LOSS_SOURCE_REQUIRED" {
		t.Fatalf("expected fail-closed result, got %+v", result.Decision)
	}
}

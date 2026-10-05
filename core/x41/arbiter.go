package x41

import (
	"errors"
	"math"
	"sync"
	"time"
)

var (
	ErrInvalidClaim  = errors.New("invalid claim")
	ErrInvalidPolicy = errors.New("invalid policy")
)

type Claim struct {
	ID             string
	ExpectedProfit int64
	MaxLoss        int64
	CapitalReq     int64
	Probability    float64
	Confidence     float64
	DataTimestamp  time.Time
	PolicyVersion  int
}

type Policy struct {
	Version             int
	MaxLossPerAction    int64
	DailyLossBudget     int64
	CurrentDailyLoss    int64
	MaxCapitalPerAction int64
	StaleDataWindow     time.Duration
	MinExpectedProfit   int64
	MinProbability      float64
	MinConfidence       float64
	MaxKellyFraction    float64
	MinKellyFraction    float64
}

type Decision struct {
	Execute           bool
	Reason            string
	VetoLevel         string
	RiskSizeMicro     int64
	KellyFraction     float64
	EffectiveFraction float64
	PolicyVersion     int
}

type Arbiter struct {
	mu     sync.Mutex
	policy Policy
}

func NewArbiter(policy Policy) (*Arbiter, error) {
	if err := validatePolicy(policy); err != nil {
		return nil, err
	}
	return &Arbiter{policy: policy}, nil
}

// EvaluateClaim is deterministic: identical policy + claim + reference time
// produces the same decision. It has no LLM, network, clock, DB, or I/O.
func (a *Arbiter) EvaluateClaim(claim Claim, now time.Time) Decision {
	a.mu.Lock()
	defer a.mu.Unlock()

	p := a.policy

	if err := validateClaim(claim); err != nil {
		return veto("invalid_claim", "RED", p.Version)
	}
	if claim.PolicyVersion != p.Version {
		return veto("mismatched_policy_version", "RED", p.Version)
	}
	if now.Before(claim.DataTimestamp) || now.Sub(claim.DataTimestamp) > p.StaleDataWindow {
		return veto("stale_or_future_data", "RED", p.Version)
	}
	if claim.MaxLoss > p.MaxLossPerAction {
		return veto("max_loss_exceeded", "RED", p.Version)
	}
	if claim.CapitalReq > p.MaxCapitalPerAction {
		return veto("capital_requirement_exceeded", "RED", p.Version)
	}
	if p.CurrentDailyLoss >= p.DailyLossBudget ||
		claim.MaxLoss > p.DailyLossBudget-p.CurrentDailyLoss {
		return veto("daily_loss_budget_exhausted", "BLACK", p.Version)
	}
	if claim.ExpectedProfit < p.MinExpectedProfit {
		return veto("expected_profit_below_floor", "YELLOW", p.Version)
	}
	if claim.Probability < p.MinProbability {
		return veto("probability_below_floor", "YELLOW", p.Version)
	}
	if claim.Confidence < p.MinConfidence {
		return veto("confidence_below_floor", "YELLOW", p.Version)
	}

	kelly := kellyFraction(claim.ExpectedProfit, claim.MaxLoss, claim.Probability)
	effective := clamp(kelly*claim.Confidence, p.MinKellyFraction, p.MaxKellyFraction)

	remaining := p.DailyLossBudget - p.CurrentDailyLoss
	risk := int64(math.Floor(float64(claim.MaxLoss) * effective))
	if risk < 1 {
		return veto("sizing_below_minimum", "YELLOW", p.Version)
	}
	if risk > remaining {
		risk = remaining
	}
	if risk > p.MaxLossPerAction {
		risk = p.MaxLossPerAction
	}
	if risk <= 0 {
		return veto("no_risk_budget_remaining", "BLACK", p.Version)
	}

	return Decision{
		Execute:           true,
		Reason:            "all_deterministic_checks_passed",
		VetoLevel:         "GREEN",
		RiskSizeMicro:     risk,
		KellyFraction:     kelly,
		EffectiveFraction: effective,
		PolicyVersion:     p.Version,
	}
}

func kellyFraction(expectedProfit, maxLoss int64, probability float64) float64 {
	if expectedProfit <= 0 || maxLoss <= 0 || probability <= 0 || probability >= 1 {
		return 0
	}
	b := float64(expectedProfit) / float64(maxLoss)
	q := 1 - probability
	return clamp((b*probability-q)/b, 0, 1)
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func validatePolicy(p Policy) error {
	if p.Version <= 0 || p.MaxLossPerAction <= 0 || p.DailyLossBudget <= 0 ||
		p.CurrentDailyLoss < 0 || p.CurrentDailyLoss > p.DailyLossBudget ||
		p.MaxCapitalPerAction <= 0 || p.StaleDataWindow <= 0 ||
		p.MinExpectedProfit < 0 || p.MinProbability < 0 || p.MinProbability > 1 ||
		p.MinConfidence < 0 || p.MinConfidence > 1 ||
		p.MaxKellyFraction <= 0 || p.MaxKellyFraction > 1 ||
		p.MinKellyFraction < 0 || p.MinKellyFraction > p.MaxKellyFraction {
		return ErrInvalidPolicy
	}
	return nil
}

func validateClaim(c Claim) error {
	if c.ID == "" || c.ExpectedProfit <= 0 || c.MaxLoss <= 0 || c.CapitalReq <= 0 ||
		c.Probability <= 0 || c.Probability > 1 ||
		c.Confidence < 0 || c.Confidence > 1 ||
		c.DataTimestamp.IsZero() {
		return ErrInvalidClaim
	}
	return nil
}

func veto(reason, level string, version int) Decision {
	return Decision{
		Execute:      false,
		Reason:       reason,
		VetoLevel:    level,
		PolicyVersion: version,
	}
}

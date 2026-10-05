package x41

import (
	"errors"
	"math"
	"time"
)

const (
	VetoGreen  = "GREEN"
	VetoYellow = "YELLOW"
	VetoRed    = "RED"
	VetoBlack  = "BLACK"
)

var (
	ErrInvalidClaim  = errors.New("invalid claim")
	ErrInvalidPolicy = errors.New("invalid policy")
)

type Claim struct {
	ID             string    `json:"id"`
	ExpectedProfit int64     `json:"expected_profit"`
	MaxLoss        int64     `json:"max_loss"`
	CapitalReq     int64     `json:"capital_req"`
	Probability    float64   `json:"probability"`
	Confidence     float64   `json:"confidence"`
	RiskScore      float64   `json:"risk_score"`
	DataTimestamp  time.Time `json:"data_timestamp"`
	PolicyVersion  int       `json:"policy_version"`
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
	MaxRiskScore        float64
	MaxKellyFraction    float64
	MinKellyFraction    float64
	MinRiskReward       float64
}

type Decision struct {
	Execute           bool    `json:"execute"`
	Reason            string  `json:"reason"`
	VetoLevel         string  `json:"veto_level"`
	RiskSizeMicro     int64   `json:"risk_size_micro"`
	KellyFraction     float64 `json:"kelly_fraction"`
	EffectiveFraction float64 `json:"effective_fraction"`
	PolicyVersion     int     `json:"policy_version"`
	ChecksPassed      int     `json:"checks_passed"`
	ChecksTotal       int     `json:"checks_total"`
}

type Arbiter struct {
	policy Policy
}

func NewArbiter(policy Policy) (*Arbiter, error) {
	if err := validatePolicy(policy); err != nil {
		return nil, err
	}
	return &Arbiter{policy: policy}, nil
}

// EvaluateClaim is the stateful convenience method. The policy is immutable
// after construction; all decision mathematics live in the pure function below.
func (a *Arbiter) EvaluateClaim(claim Claim, now time.Time) Decision {
	return EvaluateClaim(claim, a.policy, now, a.policy.CurrentDailyLoss)
}

// EvaluateClaim is pure: identical inputs always produce the same output.
// It performs no LLM, network, clock, database, reservation, or execution I/O.
func EvaluateClaim(claim Claim, policy Policy, now time.Time, currentDailyLoss int64) Decision {
	const checksTotal = 11
	passed := 0

	if err := validatePolicy(policy); err != nil {
		return veto("invalid_policy", VetoBlack, policy.Version, passed, checksTotal)
	}
	if err := validateClaim(claim); err != nil {
		return veto("invalid_claim", VetoRed, policy.Version, passed, checksTotal)
	}
	if claim.PolicyVersion != policy.Version {
		return veto("mismatched_policy_version", VetoRed, policy.Version, passed, checksTotal)
	}
	passed++

	if currentDailyLoss < 0 || currentDailyLoss > policy.DailyLossBudget {
		return veto("invalid_daily_loss_state", VetoBlack, policy.Version, passed, checksTotal)
	}
	passed++

	age := now.Sub(claim.DataTimestamp)
	if age < 0 || age > policy.StaleDataWindow {
		return veto("stale_or_future_data", VetoRed, policy.Version, passed, checksTotal)
	}
	passed++

	if claim.RiskScore > policy.MaxRiskScore {
		return veto("risk_score_exceeded", VetoRed, policy.Version, passed, checksTotal)
	}
	passed++

	if claim.MaxLoss > policy.MaxLossPerAction {
		return veto("max_loss_exceeded", VetoRed, policy.Version, passed, checksTotal)
	}
	passed++

	if claim.CapitalReq > policy.MaxCapitalPerAction {
		return veto("capital_requirement_exceeded", VetoRed, policy.Version, passed, checksTotal)
	}
	passed++

	if currentDailyLoss >= policy.DailyLossBudget || claim.MaxLoss > policy.DailyLossBudget-currentDailyLoss {
		return veto("daily_loss_budget_exhausted", VetoBlack, policy.Version, passed, checksTotal)
	}
	passed++

	if claim.ExpectedProfit < policy.MinExpectedProfit {
		return veto("expected_profit_below_floor", VetoYellow, policy.Version, passed, checksTotal)
	}
	passed++

	if claim.Probability < policy.MinProbability {
		return veto("probability_below_floor", VetoYellow, policy.Version, passed, checksTotal)
	}
	passed++

	if claim.Confidence < policy.MinConfidence {
		return veto("confidence_below_floor", VetoYellow, policy.Version, passed, checksTotal)
	}
	passed++

	if float64(claim.ExpectedProfit)/float64(claim.MaxLoss) < policy.MinRiskReward {
		return veto("risk_reward_below_floor", VetoRed, policy.Version, passed, checksTotal)
	}

	kelly := kellyFraction(claim.ExpectedProfit, claim.MaxLoss, claim.Probability)
	effective := kelly * claim.Confidence
	if effective > policy.MaxKellyFraction {
		effective = policy.MaxKellyFraction
	}
	if effective < policy.MinKellyFraction || effective <= 0 {
		return veto("kelly_fraction_below_floor", VetoYellow, policy.Version, passed, checksTotal)
	}

	remaining := policy.DailyLossBudget - currentDailyLoss
	risk := int64(math.Floor(float64(claim.MaxLoss) * effective))
	if risk < 1 {
		return veto("sizing_below_minimum", VetoYellow, policy.Version, passed, checksTotal)
	}
	if risk > remaining {
		risk = remaining
	}
	if risk > policy.MaxLossPerAction {
		risk = policy.MaxLossPerAction
	}
	if risk <= 0 {
		return veto("no_risk_budget_remaining", VetoBlack, policy.Version, passed, checksTotal)
	}

	return Decision{
		Execute:           true,
		Reason:            "all_deterministic_checks_passed",
		VetoLevel:         VetoGreen,
		RiskSizeMicro:     risk,
		KellyFraction:     kelly,
		EffectiveFraction: effective,
		PolicyVersion:     policy.Version,
		ChecksPassed:      checksTotal,
		ChecksTotal:       checksTotal,
	}
}

func kellyFraction(expectedProfit, maxLoss int64, probability float64) float64 {
	if expectedProfit <= 0 || maxLoss <= 0 || probability <= 0 || probability >= 1 {
		return 0
	}
	b := float64(expectedProfit) / float64(maxLoss)
	q := 1 - probability
	raw := (b*probability - q) / b
	return clamp(raw, 0, 1)
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
	if p.Version <= 0 ||
		p.MaxLossPerAction <= 0 ||
		p.DailyLossBudget <= 0 ||
		p.CurrentDailyLoss < 0 ||
		p.CurrentDailyLoss > p.DailyLossBudget ||
		p.MaxCapitalPerAction <= 0 ||
		p.StaleDataWindow <= 0 ||
		p.MinExpectedProfit < 0 ||
		p.MinProbability <= 0 || p.MinProbability > 1 ||
		p.MinConfidence <= 0 || p.MinConfidence > 1 ||
		p.MaxRiskScore <= 0 || p.MaxRiskScore > 1 ||
		p.MaxKellyFraction <= 0 || p.MaxKellyFraction > 1 ||
		p.MinKellyFraction <= 0 || p.MinKellyFraction > p.MaxKellyFraction ||
		p.MinRiskReward <= 0 {
		return ErrInvalidPolicy
	}
	return nil
}

func validateClaim(c Claim) error {
	if c.ID == "" ||
		c.ExpectedProfit <= 0 ||
		c.MaxLoss <= 0 ||
		c.CapitalReq <= 0 ||
		c.Probability <= 0 || c.Probability >= 1 ||
		c.Confidence <= 0 || c.Confidence > 1 ||
		math.IsNaN(c.Probability) || math.IsInf(c.Probability, 0) ||
		math.IsNaN(c.Confidence) || math.IsInf(c.Confidence, 0) ||
		math.IsNaN(c.RiskScore) || math.IsInf(c.RiskScore, 0) ||
		c.RiskScore < 0 || c.RiskScore > 1 ||
		c.DataTimestamp.IsZero() {
		return ErrInvalidClaim
	}
	return nil
}

func veto(reason, level string, version, passed, total int) Decision {
	return Decision{
		Execute:       false,
		Reason:        reason,
		VetoLevel:     level,
		PolicyVersion: version,
		ChecksPassed:  passed,
		ChecksTotal:   total,
	}
}

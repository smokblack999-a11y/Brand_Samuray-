package x41

import (
	"math"
	"time"
)

const (
	VetoGreen  = "GREEN"
	VetoYellow = "YELLOW"
	VetoRed    = "RED"
	VetoBlack  = "BLACK"
)

type Claim struct {
	ID             string
	ExpectedProfit int64
	MaxLoss        int64
	CapitalReq     int64
	Probability    float64
	Confidence     float64
	RiskScore      float64
	DataTimestamp  time.Time
	PolicyVersion  int64
}

type Policy struct {
	Version             int64
	MaxLossPerAction    int64
	DailyLossBudget     int64
	MaxCapitalPerAction int64
	StaleDataWindow     time.Duration
	MinProbability      float64
	MinConfidence       float64
	MaxRiskScore        float64
	KellyFractionCap    float64
	MinRiskReward       float64
}

type Decision struct {
	Execute       bool
	Reason        string
	VetoLevel     string
	RiskSize      int64
	PolicyVersion int64
	ChecksPassed  int
	ChecksTotal   int
}

func (p Policy) Validate() bool {
	return p.Version > 0 &&
		p.MaxLossPerAction > 0 &&
		p.DailyLossBudget > 0 &&
		p.MaxCapitalPerAction > 0 &&
		p.StaleDataWindow > 0 &&
		validProbability(p.MinProbability) &&
		validProbability(p.MinConfidence) &&
		p.MinProbability > 0 &&
		p.MinConfidence > 0 &&
		validProbability(p.MaxRiskScore) &&
		p.KellyFractionCap > 0 &&
		p.KellyFractionCap <= 1 &&
		p.MinRiskReward > 0
}

func EvaluateClaim(claim Claim, policy Policy, now time.Time, currentDailyLoss int64) Decision {
	const checks = 11
	d := Decision{PolicyVersion: policy.Version, ChecksTotal: checks}
	passed := 0

	if !policy.Validate() {
		return veto(d, passed, "INVALID_POLICY", VetoBlack)
	}
	if claim.ID == "" {
		return veto(d, passed, "CLAIM_ID_REQUIRED", VetoRed)
	}
	if claim.PolicyVersion != policy.Version {
		return veto(d, passed, "POLICY_VERSION_MISMATCH", VetoRed)
	}
	passed++

	if claim.MaxLoss <= 0 || claim.CapitalReq <= 0 || claim.ExpectedProfit <= 0 {
		return veto(d, passed, "INVALID_ECONOMIC_VALUES", VetoRed)
	}
	if currentDailyLoss < 0 {
		return veto(d, passed, "NEGATIVE_DAILY_LOSS_STATE", VetoBlack)
	}
	passed++

	if !validProbability(claim.Probability) || !validProbability(claim.Confidence) || !validProbability(claim.RiskScore) {
		return veto(d, passed, "INVALID_PROBABILITY_OR_RISK_SCORE", VetoRed)
	}
	passed++

	age := now.Sub(claim.DataTimestamp)
	if claim.DataTimestamp.IsZero() || age < 0 || age > policy.StaleDataWindow {
		return veto(d, passed, "STALE_OR_INVALID_DATA", VetoRed)
	}
	passed++

	if claim.RiskScore > policy.MaxRiskScore {
		return veto(d, passed, "RISK_SCORE_EXCEEDED", VetoRed)
	}
	passed++

	if claim.MaxLoss > policy.MaxLossPerAction {
		return veto(d, passed, "MAX_LOSS_EXCEEDED", VetoRed)
	}
	passed++

	if claim.CapitalReq > policy.MaxCapitalPerAction {
		return veto(d, passed, "CAPITAL_REQUIREMENT_EXCEEDED", VetoYellow)
	}
	passed++

	if currentDailyLoss > policy.DailyLossBudget || claim.MaxLoss > policy.DailyLossBudget-currentDailyLoss {
		return veto(d, passed, "DAILY_LOSS_BUDGET_EXCEEDED", VetoBlack)
	}
	passed++

	if claim.Probability < policy.MinProbability || claim.Confidence < policy.MinConfidence {
		return veto(d, passed, "INSUFFICIENT_CONFIDENCE", VetoRed)
	}
	passed++

	if claim.ExpectedProfit/float64(claim.MaxLoss) < policy.MinRiskReward {
		return veto(d, passed, "INSUFFICIENT_RISK_REWARD", VetoRed)
	}
	passed++

	riskSize := KellyRiskSize(claim, policy)
	if riskSize <= 0 {
		return veto(d, passed, "ZERO_RISK_SIZE", VetoRed)
	}

	remaining := policy.DailyLossBudget - currentDailyLoss
	if riskSize > remaining {
		riskSize = remaining
	}
	if riskSize > policy.MaxLossPerAction {
		riskSize = policy.MaxLossPerAction
	}
	if riskSize <= 0 {
		return veto(d, passed, "ZERO_REMAINING_RISK_BUDGET", VetoBlack)
	}

	d.Execute = true
	d.Reason = "ALL_DETERMINISTIC_CHECKS_PASSED"
	d.VetoLevel = VetoGreen
	d.RiskSize = riskSize
	d.ChecksPassed = checks
	return d
}

func KellyRiskSize(claim Claim, policy Policy) int64 {
	if claim.MaxLoss <= 0 || claim.Probability <= 0 || claim.Probability >= 1 ||
		claim.Confidence <= 0 || claim.Confidence > 1 || claim.ExpectedProfit <= 0 {
		return 0
	}

	b := float64(claim.ExpectedProfit) / float64(claim.MaxLoss)
	q := 1 - claim.Probability
	raw := (claim.Probability*b - q) / b
	if raw <= 0 {
		return 0
	}

	adjusted := raw * claim.Confidence
	adjusted = math.Min(adjusted, policy.KellyFractionCap)
	if adjusted <= 0 {
		return 0
	}

	size := math.Floor(float64(claim.MaxLoss) * adjusted)
	if size <= 0 || size > float64(math.MaxInt64) {
		return 0
	}
	return int64(size)
}

func validProbability(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 1
}

func veto(d Decision, passed int, reason, level string) Decision {
	d.Execute = false
	d.Reason = reason
	d.VetoLevel = level
	d.RiskSize = 0
	d.ChecksPassed = passed
	return d
}

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

func EvaluateClaim(claim Claim, policy Policy, now time.Time, currentDailyLoss int64) Decision {
	const checks = 8
	d := Decision{PolicyVersion: policy.Version, ChecksTotal: checks}

	if claim.ID == "" {
		return veto(d, "CLAIM_ID_REQUIRED", VetoRed)
	}
	if claim.PolicyVersion != policy.Version {
		return veto(d, "POLICY_VERSION_MISMATCH", VetoRed)
	}
	if claim.MaxLoss <= 0 || claim.CapitalReq <= 0 || claim.ExpectedProfit <= 0 {
		return veto(d, "INVALID_ECONOMIC_VALUES", VetoRed)
	}
	if currentDailyLoss < 0 {
		return veto(d, "NEGATIVE_DAILY_LOSS_STATE", VetoBlack)
	}
	if !validProbability(claim.Probability) || !validProbability(claim.Confidence) {
		return veto(d, "INVALID_PROBABILITY_OR_CONFIDENCE", VetoRed)
	}
	age := now.Sub(claim.DataTimestamp)
	if claim.DataTimestamp.IsZero() || age < 0 || age > policy.StaleDataWindow {
		return veto(d, "STALE_OR_INVALID_DATA", VetoRed)
	}
	if claim.MaxLoss > policy.MaxLossPerAction {
		return veto(d, "MAX_LOSS_EXCEEDED", VetoRed)
	}
	if claim.CapitalReq > policy.MaxCapitalPerAction {
		return veto(d, "CAPITAL_REQUIREMENT_EXCEEDED", VetoYellow)
	}
	if currentDailyLoss > policy.DailyLossBudget || claim.MaxLoss > policy.DailyLossBudget-currentDailyLoss {
		return veto(d, "DAILY_LOSS_BUDGET_EXCEEDED", VetoBlack)
	}
	if claim.Probability < policy.MinProbability || claim.Confidence < policy.MinConfidence {
		return veto(d, "INSUFFICIENT_CONFIDENCE", VetoRed)
	}
	if claim.ExpectedProfit/float64(claim.MaxLoss) < policy.MinRiskReward {
		return veto(d, "INSUFFICIENT_RISK_REWARD", VetoRed)
	}

	riskSize := KellyRiskSize(claim, policy)
	if riskSize <= 0 {
		return veto(d, "ZERO_RISK_SIZE", VetoRed)
	}
	remaining := policy.DailyLossBudget - currentDailyLoss
	if riskSize > remaining {
		riskSize = remaining
	}
	if riskSize > policy.MaxLossPerAction {
		riskSize = policy.MaxLossPerAction
	}
	if riskSize <= 0 {
		return veto(d, "ZERO_REMAINING_RISK_BUDGET", VetoBlack)
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
	if size > float64(math.MaxInt64) {
		return 0
	}
	return int64(size)
}

func validProbability(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 1
}

func veto(d Decision, reason, level string) Decision {
	d.Execute = false
	d.Reason = reason
	d.VetoLevel = level
	d.RiskSize = 0
	return d
}

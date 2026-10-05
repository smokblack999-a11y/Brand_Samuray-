package x40

import (
	"context"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
)

type Hunter interface {
	Hunt(ctx context.Context) (x41.Claim, error)
}

type Finding struct {
	Code     string
	Severity int
	RiskScore float64
}

type Killer interface {
	Attack(ctx context.Context, claim x41.Claim) ([]Finding, error)
}

type Court struct {
	Hunter Hunter
	Killer Killer
	Policy x41.Policy
	Now    func() time.Time
	DailyLoss func(context.Context) (int64, error)
}

type Result struct {
	Claim     x41.Claim
	Findings  []Finding
	Decision  x41.Decision
}

func (c Court) Evaluate(ctx context.Context) (Result, error) {
	claim, err := c.Hunter.Hunt(ctx)
	if err != nil {
		return Result{}, err
	}

	findings, err := c.Killer.Attack(ctx, claim)
	if err != nil {
		return Result{}, err
	}

	for _, f := range findings {
		if f.RiskScore > claim.RiskScore {
			claim.RiskScore = f.RiskScore
		}
	}

	if c.DailyLoss == nil {
		return Result{Claim: claim, Findings: findings, Decision: x41.Decision{
			Execute: false, Reason: "DAILY_LOSS_SOURCE_REQUIRED", VetoLevel: x41.VetoBlack,
			PolicyVersion: c.Policy.Version, ChecksTotal: 11,
		}}, nil
	}

	now := time.Now()
	if c.Now != nil {
		now = c.Now()
	}

	dailyLoss, err := c.DailyLoss(ctx)
	if err != nil {
		return Result{}, err
	}

	return Result{
		Claim: claim,
		Findings: findings,
		Decision: x41.EvaluateClaim(claim, c.Policy, now, dailyLoss),
	}, nil
}

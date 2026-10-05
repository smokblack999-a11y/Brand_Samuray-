package x39

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
)

type Reservation interface {
	Reserve(ctx context.Context, claim x41.Claim, riskSize int64) error
}

type Gate struct {
	Policy    x41.Policy
	Reserve   Reservation
	Now       func() time.Time
	DailyLoss func(ctx context.Context) (int64, error)
}

type Response struct {
	DecisionID string       `json:"decision_id"`
	Decision   x41.Decision `json:"decision"`
	Reserved   bool         `json:"reserved"`
}

type InMemoryReservation struct {
	mu       sync.Mutex
	budget   int64
	used     int64
	reserved map[string]int64
}

func NewInMemoryReservation(dailyBudget int64) *InMemoryReservation {
	return &InMemoryReservation{budget: dailyBudget, reserved: make(map[string]int64)}
}

func (r *InMemoryReservation) Reserve(ctx context.Context, claim x41.Claim, riskSize int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if existing, ok := r.reserved[claim.ID]; ok {
		if existing == riskSize {
			return nil
		}
		return errReservationConflict{}
	}
	if riskSize <= 0 || r.used > r.budget-riskSize {
		return errReservationBudget{}
	}
	r.used += riskSize
	r.reserved[claim.ID] = riskSize
	return nil
}

func (r *InMemoryReservation) Used() int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.used
}

type errReservationBudget struct{}
func (errReservationBudget) Error() string { return "RESERVATION_BUDGET_EXCEEDED" }
type errReservationConflict struct{}
func (errReservationConflict) Error() string { return "RESERVATION_IDEMPOTENCY_CONFLICT" }

func (g Gate) Evaluate(ctx context.Context, claim x41.Claim) (Response, error) {
	now := time.Now()
	if g.Now != nil {
		now = g.Now()
	}

	dailyLoss := int64(0)
	if g.DailyLoss != nil {
		v, err := g.DailyLoss(ctx)
		if err != nil {
			return Response{}, err
		}
		dailyLoss = v
	}

	decision := x41.EvaluateClaim(claim, g.Policy, now, dailyLoss)
	response := Response{DecisionID: claim.ID, Decision: decision}

	if !decision.Execute {
		return response, nil
	}
	if g.Reserve == nil {
		response.Decision.Execute = false
		response.Decision.Reason = "RESERVATION_BACKEND_REQUIRED"
		response.Decision.VetoLevel = x41.VetoBlack
		return response, nil
	}
	if err := g.Reserve.Reserve(ctx, claim, decision.RiskSize); err != nil {
		response.Decision.Execute = false
		response.Decision.Reason = err.Error()
		response.Decision.VetoLevel = x41.VetoBlack
		return response, nil
	}
	response.Reserved = true
	return response, nil
}

func (g Gate) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var claim x41.Claim
		if err := json.NewDecoder(r.Body).Decode(&claim); err != nil {
			http.Error(w, "invalid claim", http.StatusBadRequest)
			return
		}

		response, err := g.Evaluate(r.Context(), claim)
		if err != nil {
			http.Error(w, "gate unavailable", http.StatusServiceUnavailable)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if !response.Decision.Execute {
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(response)
			return
		}

		next.ServeHTTP(w, r)
	})
}

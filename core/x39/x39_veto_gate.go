package x39

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
	"github.com/smokblack999-a11y/Brand_Samuray-/core/x42"
)

type Reservation interface {
	Reserve(ctx context.Context, claim x41.Claim, riskSize int64) (string, error)
}

type Gate struct {
	Policy    x41.Policy
	Reserve   Reservation
	Audit     x42.Store
	Now       func() time.Time
	DailyLoss func(ctx context.Context) (int64, error)
}

type Response struct {
	DecisionID string       `json:"decision_id"`
	Decision   x41.Decision `json:"decision"`
	Reserved   bool         `json:"reserved"`
	ReservationID string   `json:"reservation_id,omitempty"`
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

func (r *InMemoryReservation) Reserve(ctx context.Context, claim x41.Claim, riskSize int64) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if existing, ok := r.reserved[claim.ID]; ok {
		if existing == riskSize {
			return claim.ID, nil
		}
		return "", errReservationConflict{}
	}

	if r.budget < 0 || r.used < 0 || riskSize <= 0 || r.used > r.budget || riskSize > r.budget-r.used {
		return "", errReservationBudget{}
	}

	r.used += riskSize
	r.reserved[claim.ID] = riskSize
	return claim.ID, nil
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

func (g Gate) audit(ctx context.Context, claim x41.Claim, decision x41.Decision, at time.Time) error {
	if g.Audit == nil {
		return nil
	}
	_, err := g.Audit.Append(ctx, x42.NewDecisionRecord(claim, decision, at))
	return err
}

func (g Gate) Evaluate(ctx context.Context, claim x41.Claim) (Response, error) {
	response := Response{DecisionID: claim.ID}

	if g.Audit == nil {
		response.Decision = x41.Decision{
			Execute: false, Reason: "AUDIT_BACKEND_REQUIRED", VetoLevel: x41.VetoBlack,
			PolicyVersion: g.Policy.Version, ChecksTotal: 11,
		}
		return response, nil
	}
	if g.DailyLoss == nil {
		response.Decision = x41.Decision{
			Execute: false, Reason: "DAILY_LOSS_SOURCE_REQUIRED", VetoLevel: x41.VetoBlack,
			PolicyVersion: g.Policy.Version, ChecksTotal: 11,
		}
		if err := g.audit(ctx, claim, response.Decision, time.Now().UTC()); err != nil {
			return Response{}, err
		}
		return response, nil
	}

	now := time.Now()
	if g.Now != nil {
		now = g.Now()
	}

	dailyLoss, err := g.DailyLoss(ctx)
	if err != nil {
		return Response{}, err
	}

	decision := x41.EvaluateClaim(claim, g.Policy, now, dailyLoss)
	response.Decision = decision

	if !decision.Execute {
		if err := g.audit(ctx, claim, decision, now); err != nil {
			return Response{}, err
		}
		return response, nil
	}

	if g.Reserve == nil {
		response.Decision.Execute = false
		response.Decision.Reason = "RESERVATION_BACKEND_REQUIRED"
		response.Decision.VetoLevel = x41.VetoBlack
		if err := g.audit(ctx, claim, response.Decision, now); err != nil {
			return Response{}, err
		}
		return response, nil
	}

	reservationID, reserveErr := g.Reserve.Reserve(ctx, claim, decision.RiskSizeMicro)
	if reserveErr != nil {
		response.Decision.Execute = false
		response.Decision.Reason = reserveErr.Error()
		response.Decision.VetoLevel = x41.VetoBlack
		if auditErr := g.audit(ctx, claim, response.Decision, now); auditErr != nil {
			return Response{}, auditErr
		}
		return response, nil
	}

	if err := g.audit(ctx, claim, decision, now); err != nil {
		// Fail closed: no downstream handler is called. The reservation remains
		// protected and can be reconciled by the reservation TTL/idempotency path.
		return Response{}, err
	}

	response.Reserved = true
	response.ReservationID = reservationID
	return response, nil
}

func (g Gate) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var claim x41.Claim
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&claim); err != nil {
			http.Error(w, "invalid claim", http.StatusBadRequest)
			return
		}

		response, err := g.Evaluate(r.Context(), claim)
		if err != nil {
			http.Error(w, "gate unavailable", http.StatusServiceUnavailable)
			return
		}

		if !response.Decision.Execute {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(response)
			return
		}

		r.Header.Set("X-X39-Decision-ID", response.DecisionID)
		r.Header.Set("X-X39-Reservation-ID", response.ReservationID)
		r.Header.Set("X-X39-Reserved-Risk", formatInt(response.Decision.RiskSizeMicro))
		next.ServeHTTP(w, r)
	})
}

func formatInt(v int64) string {
	if v == 0 {
		return "0"
	}
	negative := v < 0
	if negative {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

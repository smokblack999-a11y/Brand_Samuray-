package x39

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
	"github.com/smokblack999-a11y/Brand_Samuray-/core/x42"
)

func x39Policy() x41.Policy {
	return x41.Policy{
		Version: 1, MaxLossPerAction: 10, DailyLossBudget: 10, MaxCapitalPerAction: 100,
		StaleDataWindow: 30 * time.Second, MinProbability: 0.55, MinConfidence: 0.60,
		MaxRiskScore: 0.80, MaxKellyFraction: 0.25, MinKellyFraction: 0.01, MinRiskReward: 1.5,
	}
}

func x39Claim(id string) x41.Claim {
	return x41.Claim{
		ID: id, ExpectedProfit: 30, MaxLoss: 10, CapitalReq: 60,
		Probability: 0.9, Confidence: 0.9, DataTimestamp: time.Unix(1000, 0), PolicyVersion: 1,
	}
}

func TestGateConcurrentBudgetCannotBeOverReserved(t *testing.T) {
	res := NewInMemoryReservation(20)
	gate := Gate{
		Audit: new(x42.MemoryLog),
		Policy: x39Policy(), Reserve: res,
		Now: func() time.Time { return time.Unix(1001, 0) },
		DailyLoss: func(context.Context) (int64, error) { return 0, nil },
	}

	const n = 100
	var wg sync.WaitGroup
	results := make(chan Response, n)

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			out, err := gate.Evaluate(context.Background(), x39Claim("parallel-"+string(rune('a'+i))))
			if err != nil {
				t.Errorf("evaluate error: %v", err)
				return
			}
			results <- out
		}(i)
	}

	wg.Wait()
	close(results)

	executed := 0
	for r := range results {
		if r.Decision.Execute && r.Reserved {
			executed++
		}
	}
	if executed != 10 {
		t.Fatalf("expected exactly ten executions under a 20-unit budget, got %d", executed)
	}
	if got := res.Used(); got != 20 {
		t.Fatalf("reserved=%d, want 20", got)
	}
}

func TestGateFailsClosedWithoutDailyLossSource(t *testing.T) {
	gate := Gate{Policy: x39Policy(), Reserve: NewInMemoryReservation(100), Audit: new(x42.MemoryLog), Now: func() time.Time { return time.Unix(1001, 0) }}
	out, err := gate.Evaluate(context.Background(), x39Claim("no-daily-loss"))
	if err != nil || out.Decision.Execute || out.Decision.Reason != "DAILY_LOSS_SOURCE_REQUIRED" {
		t.Fatalf("unexpected response: %+v err=%v", out, err)
	}
}

func TestGateVetoesWithoutReservationBackend(t *testing.T) {
	gate := Gate{
		Policy: x39Policy(),
		Audit: new(x42.MemoryLog),
		Now: func() time.Time { return time.Unix(1001, 0) },
		DailyLoss: func(context.Context) (int64, error) { return 0, nil },
	}
	out, err := gate.Evaluate(context.Background(), x39Claim("no-backend"))
	if err != nil || out.Decision.Execute || out.Decision.Reason != "RESERVATION_BACKEND_REQUIRED" {
		t.Fatalf("unexpected response: %+v err=%v", out, err)
	}
}

func TestGateHTTPVetoBlocksHandler(t *testing.T) {
	gate := Gate{
		Policy: x39Policy(), Reserve: NewInMemoryReservation(0), Audit: new(x42.MemoryLog),
		Now: func() time.Time { return time.Unix(1001, 0) },
		DailyLoss: func(context.Context) (int64, error) { return 0, nil },
	}
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})
	server := httptest.NewServer(gate.Handler(next))
	defer server.Close()

	body := strings.NewReader(`{"ID":"blocked","ExpectedProfit":30,"MaxLoss":10,"CapitalReq":60,"Probability":0.9,"Confidence":0.9,"DataTimestamp":"1970-01-01T00:16:40Z","PolicyVersion":1}`)
	req, err := http.NewRequest(http.MethodPost, server.URL, body)
	if err != nil { t.Fatal(err) }
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil { t.Fatal(err) }
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden || called {
		t.Fatalf("expected 403 + blocked handler, status=%d called=%v", resp.StatusCode, called)
	}
}


func TestGateReservationCancellationFailsClosed(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	res := NewInMemoryReservation(100)
	gate := Gate{
		Audit: new(x42.MemoryLog),
		Policy: x39Policy(),
		Reserve: res,
		Now: func() time.Time { return time.Unix(1001, 0) },
		DailyLoss: func(context.Context) (int64, error) { return 0, nil },
	}

	out, err := gate.Evaluate(ctx, x39Claim("cancelled"))
	if err == nil {
		t.Fatalf("expected cancellation to fail closed with an error")
	}
	if out.Decision.Execute || out.Reserved {
		t.Fatalf("unexpected cancellation response: %+v", out)
	}
	if got := res.Used(); got != 0 {
		t.Fatalf("cancelled request reserved capital: %d", got)
	}
}

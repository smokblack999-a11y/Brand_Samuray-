package x39

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
)

// HTTPReservation forwards approved X39 reservations to the authoritative X33 endpoint.
type HTTPReservation struct {
	BaseURL  string
	APIKey   string
	TenantID string
	Client   *http.Client
	TTL      time.Duration
}

func (h HTTPReservation) Reserve(ctx context.Context, claim x41.Claim, riskSize int64) (string, error) {
	if strings.TrimSpace(h.BaseURL) == "" || strings.TrimSpace(h.APIKey) == "" || strings.TrimSpace(h.TenantID) == "" {
		return "", fmt.Errorf("X33_RESERVATION_CLIENT_NOT_CONFIGURED")
	}
	if riskSize <= 0 {
		return "", fmt.Errorf("X33_RESERVATION_INVALID_RISK")
	}
	ttl := h.TTL
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	payload := struct {
		TenantID     string `json:"tenant_id"`
		EventID      string `json:"event_id"`
		EstimateMicro int64 `json:"estimate_micro"`
		TTLMs        int64 `json:"ttl_ms"`
	}{h.TenantID, claim.ID, riskSize, ttl.Milliseconds()}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("X33_RESERVATION_ENCODE: %w", err)
	}
	client := h.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(h.BaseURL, "/")+"/api/x33/reserve", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("X33_RESERVATION_REQUEST: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", h.APIKey)
	req.Header.Set("X-Tenant-Id", h.TenantID)
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("X33_RESERVATION_UNAVAILABLE: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		OK    bool `json:"ok"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("X33_RESERVATION_BAD_RESPONSE")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !result.OK {
		if result.Error != nil && result.Error.Code != "" {
			return "", fmt.Errorf("X33_RESERVATION_REJECTED:%s", result.Error.Code)
		}
		return "", fmt.Errorf("X33_RESERVATION_REJECTED:HTTP_%d", resp.StatusCode)
	}
	// X33 is authoritative; derive a stable reservation identifier from the event
	// only until the endpoint exposes its canonical reservation_id.
	return claim.ID, nil
}

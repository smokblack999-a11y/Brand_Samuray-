package x42

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
)

type DecisionRecord struct {
	DecisionID    string    `json:"decision_id"`
	ClaimHash     string    `json:"claim_hash"`
	PolicyVersion int64     `json:"policy_version"`
	Decision      bool      `json:"decision"`
	Reason        string    `json:"reason"`
	VetoLevel     string    `json:"veto_level"`
	RiskSize      int64     `json:"risk_size"`
	CreatedAt     time.Time `json:"created_at"`
	PreviousHash  string    `json:"previous_hash"`
	RecordHash    string    `json:"record_hash"`
}

func NewDecisionRecord(claim x41.Claim, decision x41.Decision, at time.Time) DecisionRecord {
	return DecisionRecord{
		DecisionID: decisionID(claim.ID),
		ClaimHash: claimHash(claim),
		PolicyVersion: decision.PolicyVersion,
		Decision: decision.Execute,
		Reason: decision.Reason,
		VetoLevel: decision.VetoLevel,
		RiskSize: decision.RiskSize,
		CreatedAt: at.UTC(),
	}
}

func (r DecisionRecord) Seal(previousHash string) DecisionRecord {
	r.PreviousHash = previousHash
	r.RecordHash = ""
	payload, _ := json.Marshal(r)
	sum := sha256.Sum256(append([]byte(previousHash+"|"), payload...))
	r.RecordHash = hex.EncodeToString(sum[:])
	return r
}

type Store interface {
	Append(ctx context.Context, record DecisionRecord) (DecisionRecord, error)
}

type MemoryLog struct {
	mu sync.Mutex
	records []DecisionRecord
}

func (l *MemoryLog) Append(ctx context.Context, record DecisionRecord) (DecisionRecord, error) {
	select {
	case <-ctx.Done():
		return DecisionRecord{}, ctx.Err()
	default:
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	previous := ""
	if len(l.records) > 0 {
		previous = l.records[len(l.records)-1].RecordHash
	}
	if record.DecisionID == "" || record.ClaimHash == "" || record.CreatedAt.IsZero() {
		return DecisionRecord{}, errors.New("X42_INVALID_AUDIT_RECORD")
	}
	sealed := record.Seal(previous)
	l.records = append(l.records, sealed)
	return sealed, nil
}

func (l *MemoryLog) Records() []DecisionRecord {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]DecisionRecord, len(l.records))
	copy(out, l.records)
	return out
}

func Verify(records []DecisionRecord) bool {
	previous := ""
	for _, record := range records {
		if record.PreviousHash != previous {
			return false
		}
		if record.Seal(previous).RecordHash != record.RecordHash {
			return false
		}
		previous = record.RecordHash
	}
	return true
}

func claimHash(claim x41.Claim) string {
	payload, _ := json.Marshal(claim)
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func decisionID(id string) string {
	return id
}

package x42

import (
	"context"
	"testing"
	"time"

	"github.com/smokblack999-a11y/Brand_Samuray-/core/x41"
)

func TestMemoryLogBuildsAndVerifiesImmutableHashChain(t *testing.T) {
	log := new(MemoryLog)
	claim := x41.Claim{ID: "decision-1", PolicyVersion: 7}
	decision := x41.Decision{Execute: false, Reason: "RISK_SCORE_EXCEEDED", VetoLevel: x41.VetoRed, PolicyVersion: 7}

	if _, err := log.Append(context.Background(), NewDecisionRecord(claim, decision, time.Unix(1000, 0))); err != nil {
		t.Fatal(err)
	}
	claim.ID = "decision-2"
	if _, err := log.Append(context.Background(), NewDecisionRecord(claim, decision, time.Unix(1001, 0))); err != nil {
		t.Fatal(err)
	}

	records := log.Records()
	if len(records) != 2 || !Verify(records) {
		t.Fatalf("invalid audit chain: %+v", records)
	}

	records[0].Reason = "TAMPERED"
	if Verify(records) {
		t.Fatal("tampered record passed verification")
	}
}

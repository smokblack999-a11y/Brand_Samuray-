package arbiter

import (
	"testing"
	veto "../x39"
)

func TestVetoAdapterApprovedAndRejectedDecisions(t *testing.T) {
	a, ok := NewArbiterC(Limits{MaxVolume: 100, MaxPrice: 200, RiskFactor: 3})
	if !ok {
		t.Fatal("valid limits rejected")
	}
	adapter := NewVetoAdapter(a)

	approved := veto.Evaluate(adapter, veto.Input{Volume: 10, Price: 20, Risk: 1})
	if approved.Decision != veto.DecisionExecute {
		t.Fatalf("expected EXECUTE, got %+v", approved)
	}

	rejected := veto.Evaluate(adapter, veto.Input{Volume: 101, Price: 20, Risk: 1})
	if rejected.Decision != veto.DecisionVeto || rejected.RiskReasons&ReasonVolumeLimit == 0 {
		t.Fatalf("expected VETO with volume reason, got %+v", rejected)
	}
}

func TestVetoAdapterNilValidatorFailsClosed(t *testing.T) {
	adapter := NewVetoAdapter(nil)
	got := veto.Evaluate(adapter, veto.Input{})
	if got.Decision != veto.DecisionVeto {
		t.Fatalf("expected VETO, got %+v", got)
	}
}

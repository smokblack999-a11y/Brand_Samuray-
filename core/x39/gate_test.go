package veto

import "testing"

type stubValidator struct {
	result Validation
	panicOnCall bool
}

func (s stubValidator) Validate(int64, int64, int32) Validation {
	if s.panicOnCall {
		panic("validator failure")
	}
	return s.result
}

func TestEvaluateExecutesOnlyOnExplicitCleanApproval(t *testing.T) {
	got := Evaluate(stubValidator{result: Validation{Approved: true}}, Input{Volume: 1, Price: 2, Risk: 3})
	if got.Decision != DecisionExecute || got.Reasons != 0 || got.RiskReasons != 0 {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestEvaluateVetoesRejectedValidationAndPreservesReasons(t *testing.T) {
	const riskReasons = uint8(0x0b)
	got := Evaluate(stubValidator{result: Validation{Approved: false, Reasons: riskReasons}}, Input{})
	if got.Decision != DecisionVeto || got.RiskReasons != riskReasons || got.Reasons != 0 {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestEvaluateVetoesNilValidator(t *testing.T) {
	got := Evaluate(nil, Input{})
	if got.Decision != DecisionVeto || got.Reasons != ReasonValidatorUnavailable {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestEvaluateVetoesRejectionWithoutReason(t *testing.T) {
	got := Evaluate(stubValidator{}, Input{})
	if got.Decision != DecisionVeto || got.Reasons != ReasonUnspecifiedRejection {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestEvaluateVetoesApprovalWithReasons(t *testing.T) {
	got := Evaluate(stubValidator{result: Validation{Approved: true, Reasons: 1}}, Input{})
	if got.Decision != DecisionVeto || got.Reasons != ReasonInconsistentApproval || got.RiskReasons != 1 {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestEvaluateVetoesValidatorPanic(t *testing.T) {
	got := Evaluate(stubValidator{panicOnCall: true}, Input{})
	if got.Decision != DecisionVeto || got.Reasons != ReasonValidatorPanic {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestZeroValueDecisionIsVeto(t *testing.T) {
	var out Output
	if out.Decision != DecisionVeto {
		t.Fatalf("zero-value decision must fail closed, got %v", out.Decision)
	}
}

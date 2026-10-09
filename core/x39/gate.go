// Package veto provides a small fail-closed execution gate.
// DecisionVeto is the zero value so missing or incomplete decisions cannot execute.
package veto

type Decision uint8

const (
	DecisionVeto Decision = iota
	DecisionExecute
)

const (
	ReasonValidatorUnavailable uint16 = 1 << iota
	ReasonValidatorPanic
	ReasonUnspecifiedRejection
	ReasonInconsistentApproval
)

type Input struct {
	Volume int64
	Price  int64
	Risk   int32
}

// Validation is the narrow contract consumed from a deterministic risk validator.
// Reasons carries the validator's reason bitmask without reinterpretation.
type Validation struct {
	Approved bool
	Reasons  uint8
}

type Validator interface {
	Validate(volume, price int64, risk int32) Validation
}

type Output struct {
	Decision Decision
	Reasons  uint16
	RiskReasons uint8
}

// Evaluate defaults to VETO and only returns EXECUTE for an explicit approval
// with no rejection reasons. Validator panics are converted to a fail-closed result.
func Evaluate(v Validator, in Input) (out Output) {
	out = Output{Decision: DecisionVeto}
	defer func() {
		if recover() != nil {
			out = Output{Decision: DecisionVeto, Reasons: ReasonValidatorPanic}
		}
	}()

	if v == nil {
		out.Reasons = ReasonValidatorUnavailable
		return out
	}

	result := v.Validate(in.Volume, in.Price, in.Risk)
	out.RiskReasons = result.Reasons
	if !result.Approved {
		if result.Reasons == 0 {
			out.Reasons = ReasonUnspecifiedRejection
		}
		return out
	}
	if result.Reasons != 0 {
		out.Reasons = ReasonInconsistentApproval
		return out
	}

	out.Decision = DecisionExecute
	return out
}

package arbiter

import veto "../x39"

// VetoAdapter translates X41's deterministic result into X39's narrow gate contract.
// X39 remains independent of X41; the dependency points from the integration edge
// toward the validator, avoiding a package cycle.
type VetoAdapter struct {
	validator Validator
}

func NewVetoAdapter(v Validator) *VetoAdapter {
	return &VetoAdapter{validator: v}
}

func (a *VetoAdapter) Validate(volume, price int64, risk int32) veto.Validation {
	if a == nil || a.validator == nil {
		return veto.Validation{}
	}
	result := a.validator.Validate(volume, price, risk)
	return veto.Validation{
		Approved: result.Decision == DecisionApproved && result.Reasons == 0,
		Reasons:  result.Reasons,
	}
}

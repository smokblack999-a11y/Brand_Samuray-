package arbiter

import ("sync"; "sync/atomic")

type Decision uint8
const (DecisionApproved Decision = iota; DecisionRejected)
const (ReasonVolumeLimit uint8 = 1 << iota; ReasonPriceLimit; ReasonRiskLimit; ReasonInvalidInput)

type Result struct { Decision Decision; Reasons uint8 }
type Limits struct { MaxVolume int64; MaxPrice int64; RiskFactor int32 }

func validLimits(l Limits) bool { return l.MaxVolume >= 0 && l.MaxPrice >= 0 && l.RiskFactor >= 0 }

func evaluate(limits Limits, volume, price int64, risk int32) Result {
	var reasons uint8
	if volume < 0 || price < 0 || risk < 0 { reasons |= ReasonInvalidInput }
	if volume > limits.MaxVolume { reasons |= ReasonVolumeLimit }
	if price > limits.MaxPrice { reasons |= ReasonPriceLimit }
	if risk > limits.RiskFactor { reasons |= ReasonRiskLimit }
	if reasons != 0 { return Result{Decision: DecisionRejected, Reasons: reasons} }
	return Result{Decision: DecisionApproved}
}

type Validator interface { Validate(volume, price int64, risk int32) Result; UpdateLimits(Limits) bool }

type ArbiterA struct { limits atomic.Value }
func NewArbiterA(l Limits) (*ArbiterA,bool) { if !validLimits(l){return nil,false}; a:=&ArbiterA{}; a.limits.Store(l); return a,true }
func (a *ArbiterA) UpdateLimits(l Limits) bool { if !validLimits(l){return false}; a.limits.Store(l); return true }
func (a *ArbiterA) Validate(v,p int64,r int32) Result { return evaluate(a.limits.Load().(Limits),v,p,r) }

type snapshot struct { limits Limits }
type ArbiterC struct { snap atomic.Pointer[snapshot] }
func NewArbiterC(l Limits) (*ArbiterC,bool) { if !validLimits(l){return nil,false}; a:=&ArbiterC{}; a.snap.Store(&snapshot{limits:l}); return a,true }
func (a *ArbiterC) UpdateLimits(l Limits) bool { if !validLimits(l){return false}; a.snap.Store(&snapshot{limits:l}); return true }
func (a *ArbiterC) Validate(v,p int64,r int32) Result { return evaluate(a.snap.Load().limits,v,p,r) }

type ArbiterD struct { mu sync.RWMutex; limits Limits }
func NewArbiterD(l Limits) (*ArbiterD,bool) { if !validLimits(l){return nil,false}; return &ArbiterD{limits:l},true }
func (a *ArbiterD) UpdateLimits(l Limits) bool { if !validLimits(l){return false}; a.mu.Lock(); a.limits=l; a.mu.Unlock(); return true }
func (a *ArbiterD) Validate(v,p int64,r int32) Result { a.mu.RLock(); l:=a.limits; a.mu.RUnlock(); return evaluate(l,v,p,r) }

var _ Validator = (*ArbiterA)(nil)
var _ Validator = (*ArbiterC)(nil)
var _ Validator = (*ArbiterD)(nil)

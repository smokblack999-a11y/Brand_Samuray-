package arbiter

import ("sync"; "testing")

func TestInvalidInputFailsClosed(t *testing.T) {
	vs:=[]struct{name string; v Validator}{{"A",func()Validator{x,_:=NewArbiterA(Limits{1000,1000,10});return x}()},{"C",func()Validator{x,_:=NewArbiterC(Limits{1000,1000,10});return x}()},{"D",func()Validator{x,_:=NewArbiterD(Limits{1000,1000,10});return x}()}}
	for _,tc:=range vs { t.Run(tc.name,func(t *testing.T){ got:=tc.v.Validate(-1,1,1); if got.Decision!=DecisionRejected || got.Reasons!=ReasonInvalidInput {t.Fatalf("%+v",got)} }) }
}
func TestAllApplicableReasons(t *testing.T) {
	for _,tc:=range []Validator{func()Validator{x,_:=NewArbiterA(Limits{1000,1000,10});return x}(),func()Validator{x,_:=NewArbiterC(Limits{1000,1000,10});return x}(),func()Validator{x,_:=NewArbiterD(Limits{1000,1000,10});return x}()} {
		got:=tc.Validate(-1,2000,20); want:=ReasonInvalidInput|ReasonPriceLimit|ReasonRiskLimit
		if got.Decision!=DecisionRejected || got.Reasons!=want {t.Fatalf("got=%+v want=%d",got,want)}
	}
}
func TestAllLimitReasons(t *testing.T) {
	for _,tc:=range []Validator{func()Validator{x,_:=NewArbiterA(Limits{1000,1000,10});return x}(),func()Validator{x,_:=NewArbiterC(Limits{1000,1000,10});return x}(),func()Validator{x,_:=NewArbiterD(Limits{1000,1000,10});return x}()} {
		got:=tc.Validate(2000,2000,20); want:=ReasonVolumeLimit|ReasonPriceLimit|ReasonRiskLimit
		if got.Decision!=DecisionRejected || got.Reasons!=want {t.Fatalf("got=%+v want=%d",got,want)}
	}
}
func TestCombinedInvalidAndLimitReasons(t *testing.T) {
	want := ReasonInvalidInput | ReasonPriceLimit | ReasonRiskLimit
	for _, tc := range []Validator{
		func() Validator { x, _ := NewArbiterA(Limits{100, 100, 1}); return x }(),
		func() Validator { x, _ := NewArbiterC(Limits{100, 100, 1}); return x }(),
		func() Validator { x, _ := NewArbiterD(Limits{100, 100, 1}); return x }(),
	} {
		got := tc.Validate(-1, 200, 2)
		if got.Decision != DecisionRejected || got.Reasons != want {t.Fatalf("got=%+v want=%d", got, want)}
	}
}
func TestInvalidUpdateKeepsPreviousLimits(t *testing.T) {
	for _,tc:=range []Validator{func()Validator{x,_:=NewArbiterA(Limits{1000,1000,10});return x}(),func()Validator{x,_:=NewArbiterC(Limits{1000,1000,10});return x}(),func()Validator{x,_:=NewArbiterD(Limits{1000,1000,10});return x}()} {
		if tc.UpdateLimits(Limits{-1,2000,20}) {t.Fatal("invalid update accepted")}
		got:=tc.Validate(1500,1500,15); want:=ReasonVolumeLimit|ReasonPriceLimit|ReasonRiskLimit
		if got.Decision!=DecisionRejected || got.Reasons!=want {t.Fatalf("got=%+v",got)}
	}
}
func TestParity(t *testing.T) {
	inputs:=[]struct{v,p int64;r int32}{{0,0,0},{1000,1000,10},{1001,1000,10},{1000,1001,10},{1000,1000,11},{-1,0,0},{1500,1500,15}}
	ls:=[]Limits{{1000,1000,10},{2000,2000,20},{0,0,0}}
	for _,l:=range ls { a,_:=NewArbiterA(l);c,_:=NewArbiterC(l);d,_:=NewArbiterD(l);for _,in:=range inputs{ra,rc,rd:=a.Validate(in.v,in.p,in.r),c.Validate(in.v,in.p,in.r),d.Validate(in.v,in.p,in.r);if ra!=rc||ra!=rd{t.Fatalf("parity l=%+v in=%+v A=%+v C=%+v D=%+v",l,in,ra,rc,rd)}}}
}
func TestValidateAllocs(t *testing.T) {
	for _,tc:=range []struct{name string; v Validator}{{"A",func()Validator{x,_:=NewArbiterA(Limits{1000,1000,10});return x}()},{"C",func()Validator{x,_:=NewArbiterC(Limits{1000,1000,10});return x}()},{"D",func()Validator{x,_:=NewArbiterD(Limits{1000,1000,10});return x}()}} {
		got:=testing.AllocsPerRun(1000,func(){_ = tc.v.Validate(10,10,1)});if got!=0{t.Fatalf("%s allocations=%v",tc.name,got)}
	}
}
func testConsistency(t *testing.T,v Validator) {
	t.Helper(); c1:=Limits{1000,1000,10};c2:=Limits{2000,2000,20}
	var wg sync.WaitGroup;wg.Add(1);go func(){defer wg.Done();for i:=0;i<50000;i++{if i&1==0{v.UpdateLimits(c1)}else{v.UpdateLimits(c2)}}}()
	wg.Add(10);for i:=0;i<10;i++{go func(){defer wg.Done();for j:=0;j<10000;j++{g:=v.Validate(2500,2500,25);if g.Decision!=DecisionRejected||g.Reasons!=(ReasonVolumeLimit|ReasonPriceLimit|ReasonRiskLimit){t.Errorf("inconsistent %+v",g);return}}}()}
	wg.Wait()
}
func TestSnapshotConsistencyA(t *testing.T){a,_:=NewArbiterA(Limits{1000,1000,10});testConsistency(t,a)}
func TestSnapshotConsistencyC(t *testing.T){a,_:=NewArbiterC(Limits{1000,1000,10});testConsistency(t,a)}
func TestSnapshotConsistencyD(t *testing.T){a,_:=NewArbiterD(Limits{1000,1000,10});testConsistency(t,a)}
func TestConstructorsRejectInvalidLimits(t *testing.T){if _,ok:=NewArbiterA(Limits{-1,0,0});ok{t.Fatal("A")};if _,ok:=NewArbiterC(Limits{0,-1,0});ok{t.Fatal("C")};if _,ok:=NewArbiterD(Limits{0,0,-1});ok{t.Fatal("D")}}

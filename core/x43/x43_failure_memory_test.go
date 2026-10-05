package x43

import "testing"

func TestNormalizeFailureRemovesDynamicFragments(t *testing.T) {
	got := NormalizeFailure("stale_data order 981234 abcdef0123456789")
	want := "stale_data_order_<n>_<hex>"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestFailureMemoryClustersBeforeProposingPolicy(t *testing.T) {
	m := NewMemory()
	for i := 0; i < 3; i++ {
		m.Observe(Observation{Code: "stale_data_123", Decision: "VETO"})
	}
	c := m.Observe(Observation{Code: "stale_data_999", Decision: "VETO"})
	if c.Count != 4 || c.Blocked != 4 {
		t.Fatalf("unexpected cluster: %+v", c)
	}
	candidate, ok := m.Candidate("stale_data_1", 3)
	if !ok || candidate.Count != 4 {
		t.Fatalf("expected policy candidate, got %+v %v", candidate, ok)
	}
}

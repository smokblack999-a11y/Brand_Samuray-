package x43

import (
	"regexp"
	"strings"
	"sync"
)

var (
	digits = regexp.MustCompile("\\d+")
	hexish = regexp.MustCompile("(?i)\\b[0-9a-f]{16,}\\b")
	space = regexp.MustCompile("\\s+")
)

type Observation struct {
	Code string
	Decision string
}

type Cluster struct {
	Signature string
	Count int
	Blocked int
	Allowed int
}

type PolicyCandidate struct {
	Signature string
	Count int
	Proposal string
}

type Memory struct {
	mu sync.Mutex
	clusters map[string]*Cluster
}

func NewMemory() *Memory {
	return &Memory{clusters: make(map[string]*Cluster)}
}

func NormalizeFailure(code string) string {
	v := strings.ToLower(strings.TrimSpace(code))
	v = hexish.ReplaceAllString(v, "<hex>")
	v = digits.ReplaceAllString(v, "<n>")
	v = space.ReplaceAllString(v, "_")
	return strings.Trim(v, "_")
}

func (m *Memory) Observe(o Observation) Cluster {
	signature := NormalizeFailure(o.Code)
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.clusters[signature]
	if c == nil {
		c = &Cluster{Signature: signature}
		m.clusters[signature] = c
	}
	c.Count++
	if strings.EqualFold(o.Decision, "VETO") {
		c.Blocked++
	} else if strings.EqualFold(o.Decision, "EXECUTE") {
		c.Allowed++
	}
	return *c
}

func (m *Memory) Candidate(signature string, minimumSamples int) (PolicyCandidate, bool) {
	signature = NormalizeFailure(signature)
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.clusters[signature]
	if c == nil || c.Count < minimumSamples {
		return PolicyCandidate{}, false
	}
	return PolicyCandidate{
		Signature: signature,
		Count: c.Count,
		Proposal: "REVIEW_POLICY_FOR_" + strings.ToUpper(signature),
	}, true
}

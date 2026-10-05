package x44

type Level int

const (
	Level0 Level = iota
	Level1
	Level2
	Level3
	Level4
	Level5
)

type Metrics struct {
	AuditedRatio       float64
	InvariantPassRatio float64
	VetoPrecision      float64
	FalseVetoRate      float64
	SuccessfulCycles   int
	FailureFreeRatio   float64
}

func EvaluatePower(m Metrics) Level {
	switch {
	case m.AuditedRatio >= 1 &&
		m.InvariantPassRatio >= 0.99999 &&
		m.VetoPrecision >= 0.90 &&
		m.FalseVetoRate <= 0.02 &&
		m.SuccessfulCycles >= 10000 &&
		m.FailureFreeRatio >= 0.9999:
		return Level5
	case m.AuditedRatio >= 0.999 &&
		m.InvariantPassRatio >= 0.9999 &&
		m.VetoPrecision >= 0.80 &&
		m.FalseVetoRate <= 0.05 &&
		m.SuccessfulCycles >= 2000 &&
		m.FailureFreeRatio >= 0.999:
		return Level4
	case m.AuditedRatio >= 0.99 &&
		m.InvariantPassRatio >= 0.999 &&
		m.VetoPrecision >= 0.70 &&
		m.FalseVetoRate <= 0.10 &&
		m.SuccessfulCycles >= 500 &&
		m.FailureFreeRatio >= 0.999:
		return Level3
	case m.AuditedRatio >= 0.98 &&
		m.InvariantPassRatio >= 0.995 &&
		m.VetoPrecision >= 0.60 &&
		m.FalseVetoRate <= 0.15 &&
		m.SuccessfulCycles >= 100 &&
		m.FailureFreeRatio >= 0.995:
		return Level2
	case m.AuditedRatio >= 0.95 &&
		m.InvariantPassRatio >= 0.99 &&
		m.SuccessfulCycles >= 25:
		return Level1
	default:
		return Level0
	}
}

func Authorize(requested Level, metrics Metrics) bool {
	return EvaluatePower(metrics) >= requested
}

package arbiter

import "testing"

var benchmarkResult Result
var benchmarkVolume int64 = 500
var benchmarkPrice int64 = 500
var benchmarkRisk int32 = 5

func benchmarkValidate(b *testing.B, v Validator) {
	for b.Loop() {
		benchmarkResult = v.Validate(benchmarkVolume, benchmarkPrice, benchmarkRisk)
	}
}

func BenchmarkArbiterA(b *testing.B) {
	a, _ := NewArbiterA(Limits{1000, 1000, 10})
	benchmarkValidate(b, a)
}

func BenchmarkArbiterC(b *testing.B) {
	a, _ := NewArbiterC(Limits{1000, 1000, 10})
	benchmarkValidate(b, a)
}

func BenchmarkArbiterD(b *testing.B) {
	a, _ := NewArbiterD(Limits{1000, 1000, 10})
	benchmarkValidate(b, a)
}

// BenchmarkArbiterSnapshot emits A/C under the same benchmark body with an
// explicit implementation dimension so benchstat can perform a statistical
// A/B comparison from one benchmark binary.
func BenchmarkArbiterSnapshot(b *testing.B) {
	b.Run("impl=A", func(b *testing.B) {
		a, _ := NewArbiterA(Limits{1000, 1000, 10})
		benchmarkValidate(b, a)
	})
	b.Run("impl=C", func(b *testing.B) {
		a, _ := NewArbiterC(Limits{1000, 1000, 10})
		benchmarkValidate(b, a)
	})
}

func BenchmarkArbiterAParallel(b *testing.B) {
	a, _ := NewArbiterA(Limits{1000, 1000, 10})
	b.RunParallel(func(pb *testing.PB) {
		var sink uint8
		for pb.Next() {
			sink ^= a.Validate(benchmarkVolume, benchmarkPrice, benchmarkRisk).Reasons
		}
		benchmarkResult.Reasons = sink
	})
}

func BenchmarkArbiterCParallel(b *testing.B) {
	a, _ := NewArbiterC(Limits{1000, 1000, 10})
	b.RunParallel(func(pb *testing.PB) {
		var sink uint8
		for pb.Next() {
			sink ^= a.Validate(benchmarkVolume, benchmarkPrice, benchmarkRisk).Reasons
		}
		benchmarkResult.Reasons = sink
	})
}

func BenchmarkArbiterDParallel(b *testing.B) {
	a, _ := NewArbiterD(Limits{1000, 1000, 10})
	b.RunParallel(func(pb *testing.PB) {
		var sink uint8
		for pb.Next() {
			sink ^= a.Validate(benchmarkVolume, benchmarkPrice, benchmarkRisk).Reasons
		}
		benchmarkResult.Reasons = sink
	})
}

func BenchmarkUpdateA(b *testing.B) {
	a, _ := NewArbiterA(Limits{1000, 1000, 10})
	l := Limits{2000, 2000, 20}
	for b.Loop() {
		_ = a.UpdateLimits(l)
	}
}

func BenchmarkUpdateC(b *testing.B) {
	a, _ := NewArbiterC(Limits{1000, 1000, 10})
	l := Limits{2000, 2000, 20}
	for b.Loop() {
		_ = a.UpdateLimits(l)
	}
}

func BenchmarkUpdateD(b *testing.B) {
	a, _ := NewArbiterD(Limits{1000, 1000, 10})
	l := Limits{2000, 2000, 20}
	for b.Loop() {
		_ = a.UpdateLimits(l)
	}
}

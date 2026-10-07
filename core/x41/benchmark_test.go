package arbiter

import "testing"

func BenchmarkArbiterA(b *testing.B){a,_:=NewArbiterA(Limits{1000,1000,10});b.ResetTimer();for i:=0;i<b.N;i++{_ = a.Validate(500,500,5)}}
func BenchmarkArbiterC(b *testing.B){a,_:=NewArbiterC(Limits{1000,1000,10});b.ResetTimer();for i:=0;i<b.N;i++{_ = a.Validate(500,500,5)}}
func BenchmarkArbiterD(b *testing.B){a,_:=NewArbiterD(Limits{1000,1000,10});b.ResetTimer();for i:=0;i<b.N;i++{_ = a.Validate(500,500,5)}}
func BenchmarkArbiterAParallel(b *testing.B){a,_:=NewArbiterA(Limits{1000,1000,10});b.ResetTimer();b.RunParallel(func(pb *testing.PB){for pb.Next(){_ = a.Validate(500,500,5)}})}
func BenchmarkArbiterCParallel(b *testing.B){a,_:=NewArbiterC(Limits{1000,1000,10});b.ResetTimer();b.RunParallel(func(pb *testing.PB){for pb.Next(){_ = a.Validate(500,500,5)}})}
func BenchmarkArbiterDParallel(b *testing.B){a,_:=NewArbiterD(Limits{1000,1000,10});b.ResetTimer();b.RunParallel(func(pb *testing.PB){for pb.Next(){_ = a.Validate(500,500,5)}})}
func BenchmarkUpdateA(b *testing.B){a,_:=NewArbiterA(Limits{1000,1000,10});l:=Limits{2000,2000,20};b.ResetTimer();for i:=0;i<b.N;i++{_ = a.UpdateLimits(l)}}
func BenchmarkUpdateC(b *testing.B){a,_:=NewArbiterC(Limits{1000,1000,10});l:=Limits{2000,2000,20};b.ResetTimer();for i:=0;i<b.N;i++{_ = a.UpdateLimits(l)}}
func BenchmarkUpdateD(b *testing.B){a,_:=NewArbiterD(Limits{1000,1000,10});l:=Limits{2000,2000,20};b.ResetTimer();for i:=0;i<b.N;i++{_ = a.UpdateLimits(l)}}

# X41 — Deterministic Risk Decision Core

A small concurrent validation primitive for X10THINC/NEXUS.

## Contract
- Complete limits are published atomically as one snapshot.
- Validation is deterministic and fail-closed.
- Invalid input and violated limits are returned as a bitmask.
- Validate is required to remain allocation-free.
- A and C are immutable-snapshot implementations; D is the mutex baseline.

## Selection gate
C is the selected production candidate after the X41 evidence gate.
- Evidence run: GitHub Actions run #18 (run ID 37711793461).
- Target: GitHub Actions Ubuntu 24.04, Go 1.24.13, linux/amd64, AMD EPYC 7763.
- A/C snapshot benchmark: C measured 33.36% lower ns/op than A.
- Statistical comparison: n=20 per implementation, benchstat p=0.000 (reported; not literal zero).
- Validate: 0 B/op and 0 allocs/op for both A and C.
- Unit tests, 100× repeated tests, race detector, vet, allocation checks, benchmarks, benchstat, and escape analysis all completed successfully.
- The 22% replacement threshold is therefore exceeded on the measured target environment.
- D remains the mutex reference baseline.

This is target-environment evidence, not a universal production SLA. Revalidate on the deployment CPU/OS before making environment-specific performance claims.

## Evidence
Run in the repository's Go module:
- go test ./...
- go test -race ./...
- go vet ./...
- go test ./... -count=100
- go test ./... -bench=. -benchmem -count=20
- go install golang.org/x/perf/cmd/benchstat@latest
- benchstat -col /impl -row .name -filter '.name:ArbiterSnapshot' benchmark.txt
- go test ./... -gcflags='-m=2'

Race-detector performance numbers are not production evidence.

## Scope
The X41 core has no network, database, AI, telemetry, billing, ROS2, HFT, or hardware dependency.

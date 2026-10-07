# X41 — Deterministic Risk Decision Core

A small concurrent validation primitive for X10THINC/NEXUS.

## Contract
- Complete limits are published atomically as one snapshot.
- Validation is deterministic and fail-closed.
- Invalid input and violated limits are returned as a bitmask.
- Validate is required to remain allocation-free.
- A and C are immutable-snapshot implementations; D is the mutex baseline.

## Selection gate
A is the default production candidate.
C replaces A only when reproducible target-environment benchmarks show at least a 22% improvement without correctness, race, or allocation regression.
D remains the reference baseline.

## Evidence
Run in the repository's Go module:
- go test ./...
- go test -race ./...
- go vet ./...
- go test ./... -count=100
- go test ./... -bench=. -benchmem -count=10
- go test ./... -gcflags='-m=2'

Race-detector performance numbers are not production evidence.

## Scope
The X41 core has no network, database, AI, telemetry, billing, ROS2, HFT, or hardware dependency.

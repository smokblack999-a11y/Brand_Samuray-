# X33 Economic Consistency Engine

X33 is the financial safety layer for autonomous AI execution. PostgreSQL is the source of truth; in-memory counters are not authoritative.

## Invariants

- budget state uses BIGINT micro-KZT; 1 KZT = 1,000,000 micro-KZT.
- spent + committed must never exceed budget_limit.
- committed must equal the sum of ACTIVE reservations.
- every economic mutation is represented by one append-only ledger record.
- replaying the same reserve event with identical parameters returns the original reservation.
- replaying settlement with a different actual amount is an idempotency conflict.
- ARMED is a staging state; spending is allowed only in ACTIVE.

## Failure handling

Actual provider cost is never replaced with zero merely because authorization was exceeded. When actual cost cannot fit inside the remaining authorized budget, X33 records the authorized portion in spent, the remainder in unbudgeted_actual, releases the reservation, writes the ledger entry, and trips the tenant circuit breaker.

A settlement arriving after reservation expiry is recorded as SETTLED_AFTER_EXPIRY and treated as unbudgeted actual cost, which also trips the breaker when the amount is non-zero.

Expired reservations are released by a transactional sweeper using the same tenant budget -> reservation lock order as reserve and settle.

## Distributed state machine

ACTIVE -> TRIPPED -> MANUAL_REVIEW -> ARMED -> ACTIVE

Reserve rejects TRIPPED, MANUAL_REVIEW and ARMED tenants. Recovery must use an explicit guarded state transition; version increments on every transition.

## Window rollover

A budget window is not silently reset when its timestamp passes. A rollover is explicit, blocked when commitments remain, and represented by a WINDOW_ROLLOVER ledger entry so reconciliation remains derivable from the ledger.

## Deployment

Apply core/x33-schema.sql to PostgreSQL before enabling the engine. Install the pg driver in the production lockfile before setting the PostgreSQL storage mode.

Protect economic_ledger with a dedicated database application role and deny UPDATE, DELETE and TRUNCATE to that role. The SQL migration also installs a mutation-rejecting trigger.

Run the X33 unit suite as part of npm test. Database integration tests still need a real PostgreSQL service before X33 should be called production-ready.
-- X33 Economic Consistency Engine
-- Values are BIGINT micro-KZT: 1 KZT = 1,000,000 micro-KZT.
-- PostgreSQL is the authoritative economic state.

CREATE TYPE x33_autonomy_mode AS ENUM ('ACTIVE','TRIPPED','MANUAL_REVIEW','ARMED');
CREATE TYPE x33_reservation_status AS ENUM ('ACTIVE','SETTLED','SETTLED_WITH_OVERAGE','SETTLED_AFTER_EXPIRY','EXPIRED','OVERFLOW_REJECTED');
CREATE TYPE x33_ledger_operation AS ENUM ('RESERVE','SETTLE','SETTLE_OVERAGE','SETTLE_AFTER_EXPIRY','EXPIRE_RELEASE','WINDOW_ROLLOVER','RECONCILE_ADJUSTMENT');

CREATE TABLE IF NOT EXISTS tenant_control_state (
  tenant_id TEXT PRIMARY KEY,
  autonomy_mode x33_autonomy_mode NOT NULL DEFAULT 'ACTIVE',
  trip_reason TEXT,
  tripped_at TIMESTAMPTZ,
  repaired_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS tenant_budgets (
  tenant_id TEXT PRIMARY KEY REFERENCES tenant_control_state(tenant_id),
  budget_limit_micro_kzt BIGINT NOT NULL CHECK (budget_limit_micro_kzt >= 0),
  spent_micro_kzt BIGINT NOT NULL DEFAULT 0 CHECK (spent_micro_kzt >= 0),
  committed_micro_kzt BIGINT NOT NULL DEFAULT 0 CHECK (committed_micro_kzt >= 0),
  unbudgeted_actual_micro_kzt BIGINT NOT NULL DEFAULT 0 CHECK (unbudgeted_actual_micro_kzt >= 0),
  window_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_reset_at TIMESTAMPTZ NOT NULL,
  window_seconds BIGINT NOT NULL DEFAULT 86400 CHECK (window_seconds BETWEEN 60 AND 31536000),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT x33_budget_state_within_limit CHECK (spent_micro_kzt + committed_micro_kzt <= budget_limit_micro_kzt),
  CONSTRAINT x33_budget_window_valid CHECK (window_reset_at > window_start_at)
);

CREATE TABLE IF NOT EXISTS tenant_reservations (
  reservation_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_budgets(tenant_id),
  event_id TEXT NOT NULL,
  reserved_amount_micro BIGINT NOT NULL CHECK (reserved_amount_micro > 0),
  actual_amount_micro BIGINT CHECK (actual_amount_micro IS NULL OR actual_amount_micro >= 0),
  overage_micro BIGINT NOT NULL DEFAULT 0 CHECK (overage_micro >= 0),
  status x33_reservation_status NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  request_fingerprint TEXT NOT NULL,
  CONSTRAINT x33_unique_reservation_event UNIQUE (tenant_id,event_id)
);
CREATE INDEX IF NOT EXISTS idx_x33_reservations_expiry ON tenant_reservations(expires_at) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS idx_x33_reservations_tenant_status ON tenant_reservations(tenant_id,status);

CREATE TABLE IF NOT EXISTS economic_ledger (
  ledger_id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_budgets(tenant_id),
  reservation_id UUID NOT NULL,
  event_id TEXT NOT NULL,
  operation x33_ledger_operation NOT NULL,
  operation_key TEXT NOT NULL,
  delta_spent_micro BIGINT NOT NULL,
  delta_committed_micro BIGINT NOT NULL,
  delta_unbudgeted_micro BIGINT NOT NULL,
  previous_spent_micro BIGINT NOT NULL,
  new_spent_micro BIGINT NOT NULL,
  previous_committed_micro BIGINT NOT NULL,
  new_committed_micro BIGINT NOT NULL,
  previous_unbudgeted_micro BIGINT NOT NULL,
  new_unbudgeted_micro BIGINT NOT NULL,
  previous_hash TEXT,
  record_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT x33_unique_ledger_operation UNIQUE (tenant_id,operation_key),
  CONSTRAINT x33_unique_ledger_hash UNIQUE (tenant_id,record_hash)
);
CREATE INDEX IF NOT EXISTS idx_x33_ledger_tenant_time ON economic_ledger(tenant_id,ledger_id);

CREATE OR REPLACE FUNCTION x33_reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'X33 economic_ledger is append-only';
END;
$$;
DROP TRIGGER IF EXISTS x33_ledger_immutable ON economic_ledger;
CREATE TRIGGER x33_ledger_immutable
BEFORE UPDATE OR DELETE ON economic_ledger
FOR EACH ROW EXECUTE FUNCTION x33_reject_ledger_mutation();

-- Recommended deployment hardening (execute as table owner/admin, outside the app role):
-- REVOKE UPDATE, DELETE, TRUNCATE ON economic_ledger FROM samurai_app;
-- GRANT SELECT, INSERT ON economic_ledger TO samurai_app;
-- REVOKE ALL ON FUNCTION x33_reject_ledger_mutation() FROM PUBLIC;

COMMENT ON TABLE economic_ledger IS 'X33 append-only economic state transition ledger. Protect it further with a dedicated application role.';
COMMENT ON COLUMN tenant_budgets.unbudgeted_actual_micro_kzt IS 'Actual provider cost incurred outside authorized budget. Non-zero state forces the distributed circuit breaker to TRIPPED.';

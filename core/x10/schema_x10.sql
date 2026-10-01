CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE incident_state AS ENUM (
    'DETECTED','RECALLING_PATTERNS','PROPOSING_PATCH','POLICY_CHECKING',
    'SANDBOX_PENDING','SANDBOX_RUNNING','SANDBOX_VERIFIED','SANDBOX_CANCELLED',
    'CRITIC_EVALUATION','PROOF_GENERATION','HUMAN_APPROVAL_REQUIRED',
    'PR_CREATING','CI_PENDING','RESOLVED','REJECTED','FAILED_RECOVERY','AUTONOMY_KILLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_level AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS incidents (
  incident_id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  repository VARCHAR(255) NOT NULL,
  commit_sha VARCHAR(64) NOT NULL,
  failure_fingerprint VARCHAR(128) NOT NULL,
  state incident_state NOT NULL DEFAULT 'DETECTED',
  risk risk_level NOT NULL DEFAULT 'HIGH',
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  version BIGINT NOT NULL DEFAULT 0,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposal JSONB,
  sandbox_results JSONB,
  critics_verdicts JSONB NOT NULL DEFAULT '{}'::jsonb,
  proof_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_state_ledger (
  ledger_id BIGSERIAL PRIMARY KEY,
  incident_id VARCHAR(64) NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  from_state incident_state,
  to_state incident_state NOT NULL,
  actor VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  version BIGINT NOT NULL,
  previous_hash TEXT,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS samuraios_control (
  control_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (control_id=1),
  autonomy_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  kill_reason TEXT,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO samuraios_control(control_id) VALUES (1)
ON CONFLICT (control_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_incidents_state ON incidents(state);
CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint ON incidents(failure_fingerprint);
CREATE INDEX IF NOT EXISTS idx_incident_ledger_incident ON incident_state_ledger(incident_id,ledger_id);

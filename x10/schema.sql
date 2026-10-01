CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE x10_incident_state AS ENUM (
    'DETECTED','RECALLING_PATTERNS','PROPOSING_PATCH','POLICY_CHECKING',
    'SANDBOX_PENDING','SANDBOX_RUNNING','SANDBOX_VERIFIED','SANDBOX_CANCELLED',
    'CRITIC_EVALUATION','PROOF_GENERATION','HUMAN_APPROVAL_REQUIRED',
    'PR_CREATING','CI_PENDING','RESOLVED','REJECTED','FAILED_RECOVERY',
    'AUTONOMY_KILLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE x10_risk_level AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS x10_incidents (
  incident_id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(128) NOT NULL,
  repository VARCHAR(255) NOT NULL,
  commit_sha VARCHAR(64) NOT NULL,
  failure_fingerprint VARCHAR(128) NOT NULL,
  state x10_incident_state NOT NULL DEFAULT 'DETECTED',
  risk x10_risk_level NOT NULL DEFAULT 'HIGH',
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  version BIGINT NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_x10_incidents_state ON x10_incidents(state);
CREATE INDEX IF NOT EXISTS idx_x10_incidents_fingerprint ON x10_incidents(failure_fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS idx_x10_incidents_event_id_unique ON x10_incidents(event_id);

CREATE TABLE IF NOT EXISTS x10_state_ledger (
  ledger_id BIGSERIAL PRIMARY KEY,
  incident_id VARCHAR(64) NOT NULL REFERENCES x10_incidents(incident_id) ON DELETE CASCADE,
  from_state x10_incident_state,
  to_state x10_incident_state NOT NULL,
  actor VARCHAR(128) NOT NULL,
  reason TEXT NOT NULL,
  version BIGINT NOT NULL,
  previous_hash TEXT,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_x10_ledger_incident ON x10_state_ledger(incident_id, ledger_id);

CREATE TABLE IF NOT EXISTS x10_policy_decisions (
  decision_id BIGSERIAL PRIMARY KEY,
  incident_id VARCHAR(64) NOT NULL REFERENCES x10_incidents(incident_id) ON DELETE CASCADE,
  decision VARCHAR(32) NOT NULL,
  policy_version VARCHAR(64) NOT NULL,
  evaluation_hash VARCHAR(64) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS x10_proof_receipts (
  proof_receipt_id VARCHAR(128) PRIMARY KEY,
  incident_id VARCHAR(64) NOT NULL REFERENCES x10_incidents(incident_id) ON DELETE CASCADE,
  run_id VARCHAR(128),
  payload JSONB NOT NULL,
  previous_hash TEXT,
  proof_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS x10_kill_switch (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  actor VARCHAR(128),
  version BIGINT NOT NULL DEFAULT 0,
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO x10_kill_switch(singleton, active)
VALUES (TRUE, FALSE)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION x10_transition(
  p_incident_id VARCHAR,
  p_expected_state x10_incident_state,
  p_to_state x10_incident_state,
  p_actor VARCHAR,
  p_reason TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(new_version BIGINT, entry_hash TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  current_state x10_incident_state;
  current_version BIGINT;
  prev_hash TEXT;
  new_hash TEXT;
  kill_active BOOLEAN;
BEGIN
  SELECT active INTO kill_active FROM x10_kill_switch WHERE singleton = TRUE FOR SHARE;

  SELECT state, version INTO current_state, current_version
  FROM x10_incidents WHERE incident_id = p_incident_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'incident_not_found'; END IF;
  IF current_state <> p_expected_state THEN RAISE EXCEPTION 'state_conflict:%:%', current_state, p_expected_state; END IF;

  IF kill_active AND p_to_state NOT IN ('HUMAN_APPROVAL_REQUIRED','SANDBOX_CANCELLED','AUTONOMY_KILLED','FAILED_RECOVERY') THEN
    RAISE EXCEPTION 'autonomy_killed';
  END IF;

  IF NOT (
    (current_state='DETECTED' AND p_to_state IN ('RECALLING_PATTERNS','PROPOSING_PATCH','AUTONOMY_KILLED','FAILED_RECOVERY')) OR
    (current_state='RECALLING_PATTERNS' AND p_to_state IN ('PROPOSING_PATCH','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='PROPOSING_PATCH' AND p_to_state IN ('POLICY_CHECKING','REJECTED','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='POLICY_CHECKING' AND p_to_state IN ('SANDBOX_PENDING','HUMAN_APPROVAL_REQUIRED','REJECTED','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='SANDBOX_PENDING' AND p_to_state IN ('SANDBOX_RUNNING','SANDBOX_CANCELLED','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='SANDBOX_RUNNING' AND p_to_state IN ('SANDBOX_VERIFIED','SANDBOX_CANCELLED','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='SANDBOX_VERIFIED' AND p_to_state IN ('CRITIC_EVALUATION','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='CRITIC_EVALUATION' AND p_to_state IN ('PROOF_GENERATION','REJECTED','HUMAN_APPROVAL_REQUIRED','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='PROOF_GENERATION' AND p_to_state IN ('HUMAN_APPROVAL_REQUIRED','PR_CREATING','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='HUMAN_APPROVAL_REQUIRED' AND p_to_state IN ('PR_CREATING','REJECTED','AUTONOMY_KILLED')) OR
    (current_state='PR_CREATING' AND p_to_state IN ('CI_PENDING','FAILED_RECOVERY','AUTONOMY_KILLED')) OR
    (current_state='CI_PENDING' AND p_to_state IN ('RESOLVED','FAILED_RECOVERY','AUTONOMY_KILLED'))
  ) THEN RAISE EXCEPTION 'invalid_transition:%:%', current_state, p_to_state; END IF;

  SELECT entry_hash INTO prev_hash FROM x10_state_ledger
  WHERE incident_id=p_incident_id ORDER BY ledger_id DESC LIMIT 1;

  current_version := current_version + 1;
  new_hash := encode(digest(
    concat_ws('|', p_incident_id, coalesce(current_state::text,''), p_to_state::text,
              p_actor, p_reason, current_version::text, coalesce(prev_hash,'')),
    'sha256'
  ), 'hex');

  UPDATE x10_incidents
  SET state=p_to_state, version=current_version,
      data=data || coalesce(p_payload,'{}'::jsonb), updated_at=now()
  WHERE incident_id=p_incident_id;

  INSERT INTO x10_state_ledger(
    incident_id,from_state,to_state,actor,reason,version,previous_hash,entry_hash
  ) VALUES (
    p_incident_id,current_state,p_to_state,p_actor,p_reason,
    current_version,prev_hash,new_hash
  );

  RETURN QUERY SELECT current_version, new_hash;
END $$;
